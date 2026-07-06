// modules/clinic/clinic-staff/services/clinicMembershipInvite.service.js
//
// Business logic for User-backed clinic membership invitations (e.g. inviting
// an admin — a "near-owner" who is a DocPats User + ClinicMembership, NOT a
// ClinicEmployee).
//
// Distinct from:
//   - invitation.service.js       → external staff, OTP, creates ClinicEmployee
//   - membershipRequest.service.js → EXISTING doctor picked from search, no email
//
// This flow (variant A) handles BOTH cases through a single emailed token:
//   - the email already belongs to a DocPats User  → authenticated accept
//   - the email is new                             → register via the link,
//                                                     then bind (variant 2:
//                                                     strict token, assert
//                                                     user.email === invite.email)
//
// Token (same hybrid as StaffInvitation): a signed token carrying { inviteId }
// is emailed; only sha256(token) is stored (tokenHash). On accept we
// verifySignedToken (integrity + exp) then findOne({_id, tokenHash}).
//
// Functions:
//   - createInvitation      (owner side; STAFF_INVITE gated at the route)
//   - listInvitations       (owner side)
//   - revokeInvitation      (owner side)
//   - getInvitationPreview  (public — accept page UI)
//   - acceptInvitation      ({ token, userId }) — used by BOTH the authenticated
//                            accept endpoint AND the registration controller
//                            after User.create()

import crypto from "crypto";
import mongoose from "mongoose";

import ClinicMembershipInvite, {
  MEMBERSHIP_INVITE_STATUS,
} from "../models/clinicMembershipInvite.model.js";
import ClinicMembership from "../models/clinicMembership.model.js";
import Clinic from "../../clinic-core/models/clinic.model.js";

import {
  createSignedToken,
  verifySignedToken,
} from "../../../../common/utils/signedUrl.js";
import { canAssignRole } from "../../../../common/auth/roleHierarchy.js";
import { eventBus, EVENTS } from "../../../../common/events/eventBus.js";
import logger from "../../../../common/logger.js";

import {
  ForbiddenError,
  ConflictError,
  NotFoundError,
} from "../../../../common/utils/errors.js";

import { sendRichEmail } from "../email/sendInvitationEmail.js";
import { renderInvitationEmail } from "../email/templates.js";

const log = logger.child({ module: "clinic-staff/membership-invite" });

// ─── Constants ──────────────────────────────────────────────────

const INVITATION_TTL_DAYS = 7;
const TOKEN_TTL = `${INVITATION_TTL_DAYS}d`;
const TOKEN_PURPOSE = "membership_invite"; // discriminates from staff tokens

// ─── Helpers ────────────────────────────────────────────────────

const sha256 = (v) =>
  crypto.createHash("sha256").update(String(v)).digest("hex");

const normalizeEmail = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase();

function buildAcceptUrl(token) {
  const base = process.env.FRONTEND_URL || "https://docpats.com";
  return `${base}/clinic/membership-invitations/accept?token=${encodeURIComponent(
    token,
  )}`;
}

/**
 * Resolve an invite from a signed token. Verifies signature + expiry, checks
 * the token purpose, then binds strictly to the stored tokenHash (variant 2).
 * Returns null on any mismatch (caller turns that into NotFound).
 */
async function getInviteByToken(token) {
  let payload;
  try {
    payload = verifySignedToken(token); // throws on bad sig / expired
  } catch {
    return null;
  }
  if (!payload || payload.purpose !== TOKEN_PURPOSE) return null;
  if (!payload.inviteId || !mongoose.isValidObjectId(payload.inviteId)) {
    return null;
  }

  const tokenHash = sha256(token);
  return ClinicMembershipInvite.findOne({
    _id: payload.inviteId,
    tokenHash,
  });
}

/**
 * Throw if the invite is missing or not in a usable (pending, unexpired) state.
 * Lazily flips an overdue pending invite to "expired" (kept for audit).
 */
function ensureInviteActive(invite) {
  if (!invite) throw new NotFoundError("Invitation not found");
  if (invite.status === MEMBERSHIP_INVITE_STATUS.ACCEPTED) {
    throw new ConflictError("Invitation has already been accepted");
  }
  if (invite.status === MEMBERSHIP_INVITE_STATUS.REVOKED) {
    throw new ConflictError("Invitation has been revoked");
  }
  if (
    invite.status === MEMBERSHIP_INVITE_STATUS.EXPIRED ||
    invite.expiresAt < new Date()
  ) {
    if (invite.status === MEMBERSHIP_INVITE_STATUS.PENDING) {
      invite.status = MEMBERSHIP_INVITE_STATUS.EXPIRED;
      invite.save().catch(() => {});
    }
    throw new ConflictError("Invitation has expired");
  }
}

async function loadUserEmail(userId) {
  // Dynamic import mirrors membershipRequest.service.js (avoids a hard top-level
  // dependency on the auth module from the clinic-staff layer).
  const mod = await import("../../../../common/models/Auth/users.js");
  const User = mod.default;
  const decrypt = mod.decrypt;
  const user = await User.findById(userId).select("emailEncrypted").lean();
  if (!user) return null;
  try {
    return normalizeEmail(decrypt(user.emailEncrypted));
  } catch {
    return null;
  }
}

async function resolveClinic(clinicId, fields = "name") {
  return Clinic.findById(clinicId).select(fields).lean();
}

// ───────────────────────────────────────────────────────────────
// 1. CREATE INVITATION (owner side)
// ───────────────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {string} args.email
 * @param {string} args.role                 e.g. "admin"
 * @param {string} [args.customTitle]
 * @param {string} [args.language]
 * @param {object} args.actor                { userId, role, clinicId, inviterName? }
 * @returns {Promise<{invite, emailSent}>}
 */
export async function createInvitation({
  email,
  role,
  customTitle,
  language = "ru",
  actor,
}) {
  const { userId, role: actorRole, clinicId } = actor || {};
  if (!clinicId) throw new ForbiddenError("No active clinic context");

  // 1. Privilege guard — actor must outrank the target role.
  //    (owner -> admin passes; admin -> admin / non-owner is blocked, and the
  //    route also gates on STAFF_INVITE which admin lacks.)
  if (!canAssignRole(actorRole, role)) {
    throw new ForbiddenError(
      `Role '${actorRole}' cannot assign role '${role}'`,
    );
  }

  const normalized = normalizeEmail(email);
  const emailHash = sha256(normalized);

  // 2. Reject a duplicate pending invite (friendly error before the unique
  //    index would). Membership-already-exists is checked at accept time
  //    (we cannot reliably resolve a User by email here).
  const dup = await ClinicMembershipInvite.findOne({
    clinicId,
    emailHash,
    status: MEMBERSHIP_INVITE_STATUS.PENDING,
  });
  if (dup) {
    throw new ConflictError(
      "A pending invitation already exists for this email",
    );
  }

  // 3. Clinic name for the email.
  const clinic = await resolveClinic(clinicId, "name");
  if (!clinic) throw new NotFoundError("Clinic not found");

  // 4. Generate id + signed token first, then create with the real tokenHash
  //    (avoids a placeholder collision on the unique tokenHash index).
  const inviteId = new mongoose.Types.ObjectId();
  const token = createSignedToken(
    { inviteId: String(inviteId), purpose: TOKEN_PURPOSE },
    TOKEN_TTL,
  );
  const tokenHash = sha256(token);

  // expiresAt computed explicitly (required, no default; hooks run after
  // required-validation for non-hook fields).
  const invite = await ClinicMembershipInvite.create({
    _id: inviteId,
    clinicId,
    emailEncrypted: normalized, // pre-validate hook encrypts + sets emailHash
    role,
    customTitle: customTitle || undefined,
    tokenHash,
    status: MEMBERSHIP_INVITE_STATUS.PENDING,
    expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
    invitedBy: userId,
    language,
  });

  // 5. Send email (failure logged, does not roll back the invite).
  let emailSent = false;
  try {
    const acceptUrl = buildAcceptUrl(token);
    const { subject, htmlContent } = renderInvitationEmail({
      language,
      clinicName: clinic.name,
      role,
      inviterName: actor.inviterName || "DocPats",
      acceptUrl,
      expiresInDays: INVITATION_TTL_DAYS,
    });
    emailSent = await sendRichEmail({ to: normalized, subject, htmlContent });
  } catch (err) {
    log.error({ err, inviteId: invite._id }, "Invite email send failed");
    emailSent = false;
  }

  log.info(
    { inviteId: invite._id, clinicId, role, invitedBy: userId, emailSent },
    "Membership invite created",
  );

  return { invite, emailSent };
}

// ───────────────────────────────────────────────────────────────
// 2. LIST INVITATIONS (owner side)
// ───────────────────────────────────────────────────────────────

export async function listInvitations({
  clinicId,
  status = MEMBERSHIP_INVITE_STATUS.PENDING,
}) {
  if (!clinicId) throw new ForbiddenError("No active clinic context");

  const docs = await ClinicMembershipInvite.find({ clinicId, status }).sort({
    createdAt: -1,
  });

  return docs.map((inv) => ({
    id: String(inv._id),
    email: inv.getEmail(),
    role: inv.role,
    customTitle: inv.customTitle || null,
    status: inv.status,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    invitedBy: String(inv.invitedBy),
    language: inv.language,
  }));
}

// ───────────────────────────────────────────────────────────────
// 3. REVOKE INVITATION (owner side)
// ───────────────────────────────────────────────────────────────

export async function revokeInvitation({ inviteId, actor }) {
  const { userId, clinicId } = actor || {};
  if (!clinicId) throw new ForbiddenError("No active clinic context");
  if (!mongoose.isValidObjectId(inviteId)) {
    throw new NotFoundError("Invitation not found");
  }

  const invite = await ClinicMembershipInvite.findOne({
    _id: inviteId,
    clinicId, // tenant guard — cross-clinic revoke returns 404
  });
  if (!invite) throw new NotFoundError("Invitation not found");

  if (invite.status !== MEMBERSHIP_INVITE_STATUS.PENDING) {
    throw new ConflictError(
      `Cannot revoke invitation in status '${invite.status}'`,
    );
  }

  invite.status = MEMBERSHIP_INVITE_STATUS.REVOKED;
  invite.revokedAt = new Date();
  invite.revokedBy = userId;
  await invite.save();

  log.info(
    { inviteId: invite._id, clinicId, revokedBy: userId },
    "Membership invite revoked",
  );

  return { id: String(invite._id), status: invite.status };
}

// ───────────────────────────────────────────────────────────────
// 4. PREVIEW (public — accept page UI)
// ───────────────────────────────────────────────────────────────

export async function getInvitationPreview({ token }) {
  const invite = await getInviteByToken(token);
  ensureInviteActive(invite);

  const clinic = await resolveClinic(invite.clinicId, "name slug");

  return {
    email: invite.getEmail(),
    role: invite.role,
    customTitle: invite.customTitle || null,
    clinic: {
      id: String(invite.clinicId),
      name: clinic?.name || null,
      slug: clinic?.slug || null,
    },
    expiresAt: invite.expiresAt,
    language: invite.language,
  };
}

// ───────────────────────────────────────────────────────────────
// 5. ACCEPT ({ token, userId })
//    Used by the authenticated accept endpoint AND the registration
//    controller (called right after User.create()). In both paths we already
//    hold a userId; variant 2 asserts the user's email === invite.email.
// ───────────────────────────────────────────────────────────────

export async function acceptInvitation({ token, userId }) {
  if (!userId) throw new ForbiddenError("Not authenticated");

  const invite = await getInviteByToken(token);
  ensureInviteActive(invite);

  // Safeguard: the accepting user's email must match the invited email.
  const userEmail = await loadUserEmail(userId);
  if (!userEmail) throw new NotFoundError("User not found");
  if (userEmail !== invite.getEmail()) {
    throw new ForbiddenError(
      "This invitation was issued for a different email address",
    );
  }

  const useTx = await supportsTransactions();
  let result;

  if (useTx) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        result = await persistAccept({ invite, userId, session });
      });
    } finally {
      await session.endSession();
    }
  } else {
    result = await persistAccept({ invite, userId, session: null });
  }

  log.info(
    {
      inviteId: invite._id,
      userId: String(userId),
      clinicId: String(invite.clinicId),
      role: invite.role,
      alreadyMember: result.alreadyMember,
    },
    "Membership invite accepted",
  );

  return result;
}

/**
 * Create the ClinicMembership (unless one already exists) and mark the invite
 * accepted. Idempotent on double-accept: an existing active membership is
 * reused rather than throwing. Works inside a transaction or standalone.
 */
async function persistAccept({ invite, userId, session }) {
  const sessionOpt = session ? { session } : {};

  const existing = await ClinicMembership.findOne(
    { userId, clinicId: invite.clinicId, leftAt: null },
    null,
    { ...(session ? { session } : {}) },
  );

  let membership = existing;
  let alreadyMember = Boolean(existing);

  if (!existing) {
    const docs = await ClinicMembership.create(
      [
        {
          userId,
          clinicId: invite.clinicId,
          role: invite.role,
          customTitle: invite.customTitle || undefined,
          invitedBy: invite.invitedBy,
          actorType: "user",
          isActive: true,
          joinedAt: new Date(),
        },
      ],
      sessionOpt,
    );
    membership = docs[0];

    // Mirror addStaff's side-effect so downstream listeners still fire.
    eventBus.emitSafe(EVENTS.STAFF_JOINED, {
      membershipId: String(membership._id),
      userId: String(userId),
      clinicId: String(invite.clinicId),
      role: invite.role,
    });
  }

  invite.status = MEMBERSHIP_INVITE_STATUS.ACCEPTED;
  invite.acceptedAt = new Date();
  invite.acceptedByUserId = userId;
  await invite.save(sessionOpt);

  return {
    membershipId: String(membership._id),
    clinicId: String(invite.clinicId),
    role: invite.role,
    status: "accepted",
    alreadyMember,
  };
}

// ─── Transaction support detection (cached) ─────────────────────

let _txSupportCache = null;
async function supportsTransactions() {
  if (_txSupportCache !== null) return _txSupportCache;
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) {
      _txSupportCache = false;
      return false;
    }
    const info = await admin.command({ hello: 1 });
    _txSupportCache = Boolean(info.setName) || info.msg === "isdbgrid";
  } catch {
    _txSupportCache = false;
  }
  return _txSupportCache;
}
