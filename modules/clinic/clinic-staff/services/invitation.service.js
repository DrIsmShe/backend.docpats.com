// modules/clinic/clinic-staff/services/invitation.service.js
//
// Business logic for clinic staff invitations.
//
// Functions:
// - createInvitation: owner/admin invites a new internal employee by email
// - listInvitations: get pending invitations for current clinic
// - revokeInvitation: cancel a pending invitation
// - getInvitationPreview: public — show invitation details (clinic, role)
// - requestOtp: public — generate OTP and send via email
// - acceptInvitation: public — verify OTP, create ClinicEmployee + ClinicMembership

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
  // Cryptographically secure 6-digit code
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

function hashOtp(otp, tokenHash) {
  // OTP hash is bound to tokenHash so it cannot be replayed across invitations
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
  // Defensive: payload.invitationId might not be a valid ObjectId
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
// 1. CREATE INVITATION (owner/admin)
// ───────────────────────────────────────────────────────────────

/**
 * Create a new staff invitation. Sends an email with a signed link.
 *
 * @param {object} args
 * @param {string} args.email
 * @param {string} args.role
 * @param {string} [args.customTitle]
 * @param {string} [args.language]
 * @param {object} args.actor — { userId, role: actorRole, clinicId }
 * @returns {Promise<{invitation, emailSent}>}
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

  // 2. Dedup: reject if a pending invitation already exists for this email
  const existing = await StaffInvitation.findOne({
    clinicId,
    emailHash,
    status: "pending",
  });
  if (existing) {
    throw new ConflictError(
      "A pending invitation already exists for this email",
    );
  }

  // 3. Reject if email is already a ClinicEmployee in this clinic
  const existingEmployee = await ClinicEmployee.findOne({
    clinicId,
    emailHash,
    isDeleted: false,
  });
  if (existingEmployee) {
    throw new ConflictError(
      "This email is already registered as an employee in this clinic",
    );
  }

  // 4. Get clinic name for email
  const clinic = await Clinic.findById(clinicId).select("name").lean();
  if (!clinic) {
    throw new NotFoundError("Clinic not found");
  }

  // 5. Generate ID + token first, then create with real tokenHash.
  // (Avoids placeholder collision on the unique tokenHash index.)
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
    customTitle: customTitle || undefined,
    tokenHash,
    status: "pending",
    expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
    invitedBy: userId,
    language,
  });

  // 6. Send email (fire-and-forget logging — failure does not roll back)
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
    });
    emailSent = await sendRichEmail({
      to: normalized,
      subject,
      htmlContent,
    });
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
      emailSent,
    },
    "Invitation created",
  );

  return { invitation, emailSent };
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
    clinicId, // tenant guard — cross-clinic revoke returns 404
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

  return {
    email: invitation.getEmail(),
    role: invitation.role,
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
// 5. REQUEST OTP (public — sends OTP to invitation email)
// ───────────────────────────────────────────────────────────────

export async function requestOtp({ token }) {
  const invitation = await getInvitationByToken(token);
  ensureInvitationActive(invitation);

  // Cooldown: prevent rapid OTP spam
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
    emailSent = await sendRichEmail({
      to: email,
      subject,
      htmlContent,
    });
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
// 6. ACCEPT INVITATION (public — completes registration)
// ───────────────────────────────────────────────────────────────

/**
 * Verify OTP, create ClinicEmployee + ClinicMembership atomically.
 *
 * Note: we attempt a transaction first (works on replica sets).
 * If transactions are not supported (single-node Mongo), we fall back
 * to sequential operations. This keeps the test suite green on
 * mongodb-memory-server while still being safe in production.
 *
 * @param {object} args
 * @param {string} args.token
 * @param {string} args.otp
 * @param {string} args.password
 * @param {string} args.firstName
 * @param {string} args.lastName
 * @param {string} [args.phoneNumber]
 * @param {string} [args.language]
 * @returns {Promise<{employee}>}
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

  // 4. Verify OTP (timing-safe comparison via sha256 hash)
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
    memoryCost: 19_456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  });

  const email = invitation.getEmail();

  // 6. Create ClinicEmployee + ClinicMembership.
  //    Try transaction first; fall back to sequential operations if
  //    the underlying Mongo doesn't support transactions.
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
    },
    "Invitation accepted, employee created",
  );

  return { employee };
}

/**
 * Internal: actually create ClinicEmployee + ClinicMembership and update
 * invitation. Works both inside a transaction (when session is provided)
 * and standalone.
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

  // Final dedup check inside transaction (race-safe)
  const conflict = await ClinicEmployee.findOne({
    clinicId: invitation.clinicId,
    emailHash: invitation.emailHash,
    isDeleted: false,
  }).session(session || null);
  if (conflict) {
    throw new ConflictError(
      "An employee with this email already exists in this clinic",
    );
  }

  const employeeDocs = await ClinicEmployee.create(
    [
      {
        clinicId: invitation.clinicId,
        emailEncrypted: email,
        firstNameEncrypted: firstName,
        lastNameEncrypted: lastName,
        phoneNumberEncrypted: phoneNumber || null,
        passwordHash,
        role: invitation.role,
        customTitle: invitation.customTitle || undefined,
        invitedBy: invitation.invitedBy,
        invitationId: invitation._id,
        joinedAt: new Date(),
        preferredLanguage: language,
      },
    ],
    sessionOpt,
  );
  const employee = employeeDocs[0];

  await ClinicMembership.create(
    [
      {
        userId: employee._id, // ClinicEmployee ID acts as the user identifier
        clinicId: invitation.clinicId,
        role: invitation.role,
        isActive: true,
        joinedAt: new Date(),
        actorType: "employee",
      },
    ],
    sessionOpt,
  );

  invitation.status = "accepted";
  invitation.acceptedAt = new Date();
  invitation.acceptedBy = employee._id;
  // Clear OTP fields — single use
  invitation.otpHash = null;
  invitation.otpExpiresAt = null;
  await invitation.save(sessionOpt);

  return employee;
}

/**
 * Detect whether the connected Mongo deployment supports transactions.
 * Standalone Mongo (single-node, no replset) does not. Replica sets and
 * sharded clusters do. We cache the result for the lifetime of the process.
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
    // Replica sets expose `setName`. Sharded clusters expose `msg: 'isdbgrid'`.
    _txSupportCache = Boolean(info.setName) || info.msg === "isdbgrid";
  } catch {
    _txSupportCache = false;
  }
  return _txSupportCache;
}
