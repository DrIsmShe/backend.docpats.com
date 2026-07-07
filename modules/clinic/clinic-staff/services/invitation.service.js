// modules/clinic/clinic-staff/services/invitation.service.js
//
// Business logic for clinic staff invitations (Global Clinic Worker model).
//
// A ClinicEmployee is a GLOBAL identity (unique emailHash across the system).
// Hiring links that identity to a clinic via ClinicMembership; it does NOT
// duplicate the identity. createInvitation is "smart" (single endpoint):
//
//   email entered → is there already a global ClinicEmployee for it?
//     ├─ NO  → kind:"new"      invitation (OTP + password → create identity)
//     └─ YES → already active in THIS clinic? → 409
//              else → kind:"existing" invitation (one-click consent, no OTP,
//                     no password → just create a membership for this clinic)
//
// Functions:
// - createInvitation: owner/admin invites by email (auto new/existing)
// - listInvitations: pending invitations for current clinic
// - revokeInvitation: cancel a pending invitation
// - getInvitationPreview: public — invitation details (incl. kind)
// - requestOtp: public — OTP for kind:"new" only
// - acceptInvitation: public — new → create identity+membership;
//                              existing → one-click membership

import crypto from "crypto";
import argon2 from "argon2";
import mongoose from "mongoose";

import StaffInvitation from "../models/staffInvitation.model.js";
import ClinicEmployee from "../models/clinicEmployee.model.js";
import ClinicMembership from "../models/clinicMembership.model.js";
import Clinic from "../../clinic-core/models/clinic.model.js";

import {
  createSignedToken,
  verifySignedToken,
} from "../../../../common/utils/signedUrl.js";
import { canAssignRole } from "../../../../common/auth/roleHierarchy.js";
import logger from "../../../../common/logger.js";

import {
  ValidationError,
  ForbiddenError,
  ConflictError,
  NotFoundError,
  UnprocessableError,
  RateLimitError,
} from "../../../../common/utils/errors.js";

import { sendRichEmail } from "../email/sendInvitationEmail.js";
import { renderInvitationEmail, renderOtpEmail } from "../email/templates.js";

const log = logger.child({ module: "clinic-staff/invitation" });

// ─── Constants ──────────────────────────────────────────────────

const INVITATION_TTL_DAYS = 7;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 3;
const OTP_REQUEST_COOLDOWN_MS = 60 * 1000; // 1 min between OTP requests
const TOKEN_TTL = `${INVITATION_TTL_DAYS}d`;

// ─── Helpers ────────────────────────────────────────────────────

const sha256 = (v) =>
  crypto.createHash("sha256").update(String(v)).digest("hex");

const normalizeEmail = (v) => String(v).trim().toLowerCase();

function generateOtp() {
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

function hashOtp(otp, tokenHash) {
  return sha256(`${otp}:${tokenHash}`);
}

function buildAcceptUrl(token) {
  const base = process.env.FRONTEND_URL || "https://docpats.com";
  return `${base}/clinic/invitations/accept?token=${encodeURIComponent(token)}`;
}

// ─── Internal helpers ───────────────────────────────────────────

async function getInvitationByToken(token) {
  const payload = verifySignedToken(token);
  if (!payload) return null;
  if (!payload.invitationId) return null;
  if (!mongoose.isValidObjectId(payload.invitationId)) return null;

  const tokenHash = sha256(token);
  const invitation = await StaffInvitation.findOne({
    _id: payload.invitationId,
    tokenHash,
  });
  return invitation;
}

function ensureInvitationActive(invitation) {
  if (!invitation) {
    throw new NotFoundError("Invitation not found");
  }
  if (invitation.status === "accepted") {
    throw new ConflictError("Invitation has already been accepted");
  }
  if (invitation.status === "revoked") {
    throw new ConflictError("Invitation has been revoked");
  }
  if (invitation.status === "expired" || invitation.expiresAt < new Date()) {
    if (invitation.status === "pending") {
      invitation.status = "expired";
      invitation.save().catch(() => {});
    }
    throw new ConflictError("Invitation has expired");
  }
}

// ───────────────────────────────────────────────────────────────
// 1. CREATE INVITATION (owner/admin) — smart new/existing routing
// ───────────────────────────────────────────────────────────────

/**
 * Create a staff invitation. Automatically routes:
 *   - existing global worker identity → kind:"existing" (one-click consent)
 *   - unknown email                   → kind:"new" (OTP + password)
 *
 * @param {object} args
 * @param {string} args.email
 * @param {string} args.role
 * @param {string} [args.customTitle]
 * @param {string} [args.language]
 * @param {object} args.actor — { userId, role: actorRole, clinicId, inviterName }
 * @returns {Promise<{invitation, emailSent, kind}>}
 */
export async function createInvitation({
  email,
  role,
  customTitle,
  language = "ru",
  actor,
}) {
  const { userId, role: actorRole, clinicId } = actor;

  // 1. Privilege escalation guard — actor cannot invite role >= their own
  if (!canAssignRole(actorRole, role)) {
    throw new ForbiddenError(
      `Role '${actorRole}' cannot assign role '${role}'`,
    );
  }

  const normalized = normalizeEmail(email);
  const emailHash = sha256(normalized);

  // 2. One pending invitation per (clinic, email) — applies to both kinds.
  const pending = await StaffInvitation.findOne({
    clinicId,
    emailHash,
    status: "pending",
  });
  if (pending) {
    throw new ConflictError(
      "A pending invitation already exists for this email",
    );
  }

  // 3. Clinic (for email content) — needed by both branches.
  const clinic = await Clinic.findById(clinicId).select("name").lean();
  if (!clinic) {
    throw new NotFoundError("Clinic not found");
  }

  // 4. Is there already a GLOBAL worker identity for this email?
  const existingEmployee = await ClinicEmployee.findOne({
    emailHash,
    isPlatformDeleted: false,
  });

  if (existingEmployee) {
    // 4a. Already an active member of THIS clinic → nothing to do.
    const activeHere = await ClinicMembership.findOne({
      userId: existingEmployee._id,
      clinicId,
      actorType: "employee",
      leftAt: null,
    });
    if (activeHere) {
      throw new ConflictError("This worker is already in your clinic team");
    }
    // 4b. Route to the "existing" one-click-consent flow.
    return createExistingWorkerInvitation({
      existingEmployee,
      role,
      customTitle,
      language,
      clinic,
      actor: {
        userId,
        role: actorRole,
        clinicId,
        inviterName: actor.inviterName,
      },
      normalized,
    });
  }

  // 5. Unknown email → NEW flow: signed token + StaffInvitation(kind:"new").
  const invitationId = new mongoose.Types.ObjectId();
  const token = createSignedToken(
    { invitationId: String(invitationId) },
    TOKEN_TTL,
  );
  const tokenHash = sha256(token);

  const invitation = await StaffInvitation.create({
    _id: invitationId,
    clinicId,
    emailEncrypted: normalized,
    role,
    kind: "new",
    customTitle: customTitle || undefined,
    tokenHash,
    status: "pending",
    expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
    invitedBy: userId,
    language,
  });

  let emailSent = false;
  try {
    const acceptUrl = buildAcceptUrl(token);
    const { subject, htmlContent } = renderInvitationEmail({
      language,
      clinicName: clinic.name,
      role,
      inviterName: actor.inviterName || "Clinic Admin",
      acceptUrl,
      expiresInDays: INVITATION_TTL_DAYS,
      isExistingWorker: false,
    });
    emailSent = await sendRichEmail({ to: normalized, subject, htmlContent });
  } catch (err) {
    log.error({ err, invitationId: invitation._id }, "Email send failed");
    emailSent = false;
  }

  log.info(
    {
      invitationId: invitation._id,
      clinicId,
      role,
      invitedBy: userId,
      kind: "new",
      emailSent,
    },
    "Invitation created (new worker)",
  );

  return { invitation, emailSent, kind: "new" };
}

/**
 * Internal: create a kind:"existing" invitation for a worker who already has
 * a global ClinicEmployee identity. Accepting is a one-click consent that
 * only creates a ClinicMembership — no OTP, no new password, no new identity.
 */
async function createExistingWorkerInvitation({
  existingEmployee,
  role,
  customTitle,
  language,
  clinic,
  actor,
  normalized,
}) {
  const { userId, clinicId } = actor;

  const invitationId = new mongoose.Types.ObjectId();
  const token = createSignedToken(
    { invitationId: String(invitationId) },
    TOKEN_TTL,
  );
  const tokenHash = sha256(token);

  const invitation = await StaffInvitation.create({
    _id: invitationId,
    clinicId,
    emailEncrypted: normalized,
    role,
    kind: "existing",
    existingEmployeeId: existingEmployee._id,
    customTitle: customTitle || undefined,
    tokenHash,
    status: "pending",
    expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
    invitedBy: userId,
    language,
  });

  let emailSent = false;
  try {
    const acceptUrl = buildAcceptUrl(token);
    const { subject, htmlContent } = renderInvitationEmail({
      language,
      clinicName: clinic.name,
      role,
      inviterName: actor.inviterName || "Clinic Admin",
      acceptUrl,
      expiresInDays: INVITATION_TTL_DAYS,
      isExistingWorker: true,
    });
    emailSent = await sendRichEmail({ to: normalized, subject, htmlContent });
  } catch (err) {
    log.error({ err, invitationId: invitation._id }, "Email send failed");
    emailSent = false;
  }

  log.info(
    {
      invitationId: invitation._id,
      clinicId,
      role,
      invitedBy: userId,
      kind: "existing",
      existingEmployeeId: String(existingEmployee._id),
      emailSent,
    },
    "Invitation created (existing worker)",
  );

  return { invitation, emailSent, kind: "existing" };
}

// ───────────────────────────────────────────────────────────────
// 2. LIST INVITATIONS (owner/admin)
// ───────────────────────────────────────────────────────────────

export async function listInvitations({ clinicId, status = "pending" }) {
  const invitationDocs = await StaffInvitation.find({
    clinicId,
    status,
  }).sort({ createdAt: -1 });

  return invitationDocs.map((inv) => ({
    id: String(inv._id),
    email: inv.getEmail(),
    role: inv.role,
    kind: inv.kind || "new",
    customTitle: inv.customTitle || null,
    status: inv.status,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    invitedBy: String(inv.invitedBy),
    language: inv.language,
  }));
}

// ───────────────────────────────────────────────────────────────
// 3. REVOKE INVITATION (owner/admin)
// ───────────────────────────────────────────────────────────────

export async function revokeInvitation({ invitationId, actor }) {
  const { userId, clinicId } = actor;

  if (!mongoose.isValidObjectId(invitationId)) {
    throw new NotFoundError("Invitation not found");
  }

  const invitation = await StaffInvitation.findOne({
    _id: invitationId,
    clinicId,
  });

  if (!invitation) {
    throw new NotFoundError("Invitation not found");
  }

  if (invitation.status !== "pending") {
    throw new ConflictError(
      `Cannot revoke invitation in status '${invitation.status}'`,
    );
  }

  invitation.status = "revoked";
  invitation.revokedAt = new Date();
  invitation.revokedBy = userId;
  await invitation.save();

  log.info(
    { invitationId: invitation._id, clinicId, revokedBy: userId },
    "Invitation revoked",
  );

  return invitation;
}

// ───────────────────────────────────────────────────────────────
// 4. PREVIEW INVITATION (public — for accept page UI)
// ───────────────────────────────────────────────────────────────

export async function getInvitationPreview({ token }) {
  const invitation = await getInvitationByToken(token);
  ensureInvitationActive(invitation);

  const clinic = await Clinic.findById(invitation.clinicId)
    .select("name slug")
    .lean();

  const kind = invitation.kind || "new";

  return {
    email: invitation.getEmail(),
    role: invitation.role,
    kind,
    // Frontend uses this to branch the UI:
    //   "new"      → full form (OTP + name + password)
    //   "existing" → single "Accept" button (one-click consent)
    isExistingWorker: kind === "existing",
    customTitle: invitation.customTitle || null,
    clinic: {
      id: String(invitation.clinicId),
      name: clinic?.name || null,
      slug: clinic?.slug || null,
    },
    expiresAt: invitation.expiresAt,
    language: invitation.language,
  };
}

// ───────────────────────────────────────────────────────────────
// 5. REQUEST OTP (public — kind:"new" only)
// ───────────────────────────────────────────────────────────────

export async function requestOtp({ token }) {
  const invitation = await getInvitationByToken(token);
  ensureInvitationActive(invitation);

  if ((invitation.kind || "new") === "existing") {
    // Existing workers accept with one click — no OTP is issued.
    throw new UnprocessableError(
      "This invitation does not require an OTP. Accept it directly.",
    );
  }

  if (
    invitation.otpRequestedAt &&
    Date.now() - invitation.otpRequestedAt.getTime() < OTP_REQUEST_COOLDOWN_MS
  ) {
    const retryAfter = Math.ceil(
      (OTP_REQUEST_COOLDOWN_MS -
        (Date.now() - invitation.otpRequestedAt.getTime())) /
        1000,
    );
    throw new RateLimitError(
      "Please wait before requesting a new OTP",
      retryAfter,
    );
  }

  const otp = generateOtp();
  const otpHash = hashOtp(otp, invitation.tokenHash);

  invitation.otpHash = otpHash;
  invitation.otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  invitation.otpAttemptsLeft = OTP_MAX_ATTEMPTS;
  invitation.otpRequestedAt = new Date();
  await invitation.save();

  const email = invitation.getEmail();
  const { subject, htmlContent } = renderOtpEmail({
    language: invitation.language,
    otp,
    expiresInMinutes: OTP_TTL_MINUTES,
  });

  let emailSent = false;
  try {
    emailSent = await sendRichEmail({ to: email, subject, htmlContent });
  } catch (err) {
    log.error({ err, invitationId: invitation._id }, "OTP email send failed");
  }

  log.info(
    { invitationId: invitation._id, emailSent },
    "OTP generated and sent",
  );

  return { sent: emailSent, expiresInMinutes: OTP_TTL_MINUTES };
}

// ───────────────────────────────────────────────────────────────
// 6. ACCEPT INVITATION (public)
// ───────────────────────────────────────────────────────────────

/**
 * Accept an invitation.
 *   - kind:"existing" → one-click consent: link the existing global identity
 *     to this clinic via a new ClinicMembership. No OTP, no password.
 *   - kind:"new"      → verify OTP, find-or-create the global ClinicEmployee
 *     identity, create the ClinicMembership.
 */
export async function acceptInvitation({
  token,
  otp,
  password,
  firstName,
  lastName,
  phoneNumber,
  language = "ru",
}) {
  const invitation = await getInvitationByToken(token);
  ensureInvitationActive(invitation);

  // ── EXISTING worker: one-click consent ──
  if ((invitation.kind || "new") === "existing") {
    return acceptExistingInvitation({ invitation });
  }

  // ── NEW worker: OTP + password → create identity ──

  // 1. Check OTP exists
  if (!invitation.otpHash || !invitation.otpExpiresAt) {
    throw new UnprocessableError("OTP not requested. Call request-otp first.");
  }
  // 2. Check OTP expiry
  if (invitation.otpExpiresAt < new Date()) {
    throw new ConflictError("OTP has expired. Request a new one.");
  }
  // 3. Check OTP attempts left
  if (invitation.otpAttemptsLeft <= 0) {
    throw new ConflictError("Too many failed attempts. Request a new OTP.");
  }
  // 4. Verify OTP (timing-safe)
  const expectedHash = hashOtp(otp, invitation.tokenHash);
  const isValidOtp =
    expectedHash.length === invitation.otpHash.length &&
    crypto.timingSafeEqual(
      Buffer.from(expectedHash),
      Buffer.from(invitation.otpHash),
    );
  if (!isValidOtp) {
    invitation.otpAttemptsLeft = Math.max(0, invitation.otpAttemptsLeft - 1);
    await invitation.save();
    throw new ForbiddenError(
      `Invalid OTP. ${invitation.otpAttemptsLeft} attempts left.`,
    );
  }

  // 5. Hash password with argon2
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const email = invitation.getEmail();

  // 6. Persist (transaction if supported)
  let employee;
  const useTransaction = await supportsTransactions();

  if (useTransaction) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        employee = await persistAcceptInvitation({
          invitation,
          email,
          firstName,
          lastName,
          phoneNumber,
          passwordHash,
          language,
          session,
        });
      });
    } finally {
      await session.endSession();
    }
  } else {
    employee = await persistAcceptInvitation({
      invitation,
      email,
      firstName,
      lastName,
      phoneNumber,
      passwordHash,
      language,
      session: null,
    });
  }

  log.info(
    {
      invitationId: invitation._id,
      employeeId: employee._id,
      clinicId: invitation.clinicId,
      role: invitation.role,
      kind: "new",
    },
    "Invitation accepted, worker joined clinic",
  );

  return { employee };
}

/**
 * Internal: accept a kind:"existing" invitation. Links the existing global
 * ClinicEmployee identity to the clinic via a new ClinicMembership. The
 * worker keeps their existing login/password — nothing about the identity
 * changes here.
 */
async function acceptExistingInvitation({ invitation }) {
  const employee = await ClinicEmployee.findOne({
    _id: invitation.existingEmployeeId,
    isPlatformDeleted: false,
  });
  if (!employee) {
    throw new NotFoundError("Worker identity not found");
  }

  // Idempotency / race guard: only create a membership if not already active.
  const already = await ClinicMembership.findOne({
    userId: employee._id,
    clinicId: invitation.clinicId,
    actorType: "employee",
    leftAt: null,
  });
  if (!already) {
    await ClinicMembership.create({
      userId: employee._id,
      clinicId: invitation.clinicId,
      role: invitation.role,
      isActive: true,
      joinedAt: new Date(),
      actorType: "employee",
    });
  }

  invitation.status = "accepted";
  invitation.acceptedAt = new Date();
  invitation.acceptedBy = employee._id;
  await invitation.save();

  log.info(
    {
      invitationId: invitation._id,
      employeeId: String(employee._id),
      clinicId: String(invitation.clinicId),
      role: invitation.role,
      kind: "existing",
      created: !already,
    },
    "Existing worker joined clinic via invitation",
  );

  return { employee };
}

/**
 * Internal: for kind:"new" — find-or-create the GLOBAL ClinicEmployee identity
 * (by global emailHash) and link it to the clinic via ClinicMembership.
 *
 * Find-or-create makes this race-safe: if the identity already exists (e.g.
 * created concurrently by another clinic), we reuse it instead of hitting the
 * unique emailHash index. The identity no longer carries clinicId/role — those
 * live on the membership.
 */
async function persistAcceptInvitation({
  invitation,
  email,
  firstName,
  lastName,
  phoneNumber,
  passwordHash,
  language,
  session,
}) {
  const sessionOpt = session ? { session } : {};

  // 1. Find-or-create the global identity.
  let employee = await ClinicEmployee.findOne({
    emailHash: invitation.emailHash,
    isPlatformDeleted: false,
  }).session(session || null);

  if (!employee) {
    const employeeDocs = await ClinicEmployee.create(
      [
        {
          emailEncrypted: email,
          firstNameEncrypted: firstName,
          lastNameEncrypted: lastName,
          phoneNumberEncrypted: phoneNumber || null,
          passwordHash,
          customTitle: invitation.customTitle || undefined,
          invitedBy: invitation.invitedBy,
          invitationId: invitation._id,
          joinedAt: new Date(),
          preferredLanguage: language,
        },
      ],
      sessionOpt,
    );
    employee = employeeDocs[0];
  }

  // 2. Link into this clinic (skip if somehow already active).
  const already = await ClinicMembership.findOne({
    userId: employee._id,
    clinicId: invitation.clinicId,
    actorType: "employee",
    leftAt: null,
  }).session(session || null);

  if (!already) {
    await ClinicMembership.create(
      [
        {
          userId: employee._id,
          clinicId: invitation.clinicId,
          role: invitation.role,
          isActive: true,
          joinedAt: new Date(),
          actorType: "employee",
        },
      ],
      sessionOpt,
    );
  }

  // 3. Close the invitation.
  invitation.status = "accepted";
  invitation.acceptedAt = new Date();
  invitation.acceptedBy = employee._id;
  invitation.otpHash = null;
  invitation.otpExpiresAt = null;
  await invitation.save(sessionOpt);

  return employee;
}

/**
 * Detect whether the connected Mongo deployment supports transactions.
 */
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
