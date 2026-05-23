// server/modules/auth/services/completeProvisional.service.js
//
// Activation flow for provisional User accounts created by a clinic.
//
// A patient logs in with their tmp credentials (printed on the clinic
// card), and the FIRST thing they're required to do is change their
// email + password to permanent ones. This service is the storage-level
// implementation of that "complete registration" step.
//
// Called from:
//   POST /api/auth/complete-provisional-registration
//
// Preconditions enforced by this service:
//   1. The session belongs to a real User
//   2. That User has isProvisional === true
//   3. The User is NOT already anonymized / blocked
//   4. The new email is not taken by anyone else (via emailHash)
//   5. The new password meets minimum length policy
//
// On success:
//   - emailEncrypted is updated (pre-save hook re-hashes + re-encrypts)
//   - password is set to a new argon2 hash
//   - isProvisional → false
//   - mustCompleteRegistration → false
//   - mustChangePassword → false
//   - lastPasswordChangeAt → now
//   - registeredAt → now (mark as "fully registered now")
//   - Returns the decrypted-shape User DTO

import argon2 from "argon2";
import crypto from "crypto";
import mongoose from "mongoose";

import User from "../../../common/models/Auth/users.js";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
} from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

const log = logger.child({ module: "auth/complete-provisional" });

// Minimum password length — matches User model's other consumers
// (StaffInvitation acceptInvitation uses min 8 as well).
const MIN_PASSWORD_LENGTH = 8;

// Same normalization as elsewhere — trim + lowercase before hashing.
const normalizeEmail = (v) => String(v).trim().toLowerCase();

const sha256 = (v) =>
  crypto.createHash("sha256").update(String(v)).digest("hex");

/**
 * Complete the provisional → permanent activation for the user
 * identified by `userId`.
 *
 * @param {object} input
 * @param {string} input.userId      — current session user
 * @param {string} input.newEmail    — new permanent email
 * @param {string} input.newPassword — new permanent password
 * @returns {Promise<{user: object}>}
 */
export async function completeProvisionalRegistration({
  userId,
  newEmail,
  newPassword,
}) {
  if (!userId || !mongoose.isValidObjectId(userId)) {
    throw new ValidationError("Invalid session user");
  }
  if (typeof newEmail !== "string" || !newEmail.trim()) {
    throw new ValidationError("newEmail is required", { field: "newEmail" });
  }
  if (typeof newPassword !== "string" || !newPassword) {
    throw new ValidationError("newPassword is required", {
      field: "newPassword",
    });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      { field: "newPassword" },
    );
  }
  // Basic email shape — full validation lives in the zod schema upstream.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    throw new ValidationError("Invalid email format", { field: "newEmail" });
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new NotFoundError("User");
  }

  if (!user.isProvisional) {
    // Defensive — endpoint should only be reachable to provisional users,
    // but we double-check at the service layer.
    throw new ForbiddenError(
      "This account is not a provisional account — nothing to activate",
    );
  }

  if (user.isAnonymized) {
    throw new ForbiddenError("Account has been anonymized and cannot be used");
  }
  if (user.isBlocked) {
    throw new ForbiddenError("Account is blocked");
  }

  // ─── Email uniqueness check ───
  // The new email must not collide with anyone else. Use emailHash for
  // an O(1) indexed lookup.
  const normalized = normalizeEmail(newEmail);
  const newEmailHash = sha256(normalized);

  // If user accidentally types their own current tmp email — reject so
  // they can't just "complete" without actually changing anything.
  if (newEmailHash === user.emailHash) {
    throw new ValidationError(
      "New email must differ from your temporary email",
      { field: "newEmail" },
    );
  }

  // Anyone else with this email already? (excluding the current user)
  const existing = await User.findOne({
    emailHash: newEmailHash,
    _id: { $ne: user._id },
    isAnonymized: { $ne: true },
  })
    .select("_id")
    .lean();

  if (existing) {
    throw new ConflictError("This email is already registered", {
      field: "newEmail",
    });
  }

  // ─── Apply changes ───
  // Pre-save hook on User encrypts emailEncrypted and recomputes
  // emailHash automatically — we just assign the plaintext.
  user.emailEncrypted = normalized;
  user.password = await argon2.hash(newPassword, { type: argon2.argon2id });

  user.isProvisional = false;
  user.mustCompleteRegistration = false;
  user.mustChangePassword = false;

  // Clear provisional-specific fields (TTL is meaningless once activated).
  // We keep provisionalCreatedBy + provisionalCreatedAt for audit/forensics
  // — useful to know which clinic onboarded a now-permanent patient.
  user.provisionalExpiresAt = null;

  user.lastPasswordChangeAt = new Date();
  // Mark this as the patient's actual registration moment from their
  // own perspective (the original registeredAt was when the clinic
  // created the record, which is different).
  user.registeredAt = new Date();

  await user.save();

  log.info(
    {
      userId: String(user._id),
      provisionalCreatedBy: user.provisionalCreatedBy
        ? String(user.provisionalCreatedBy)
        : null,
    },
    "Provisional user activated",
  );

  // Return the public User shape — toJSON strips encrypted/hash fields
  // and exposes virtuals (firstName/lastName/email).
  return { user: user.toJSON() };
}

export default { completeProvisionalRegistration };
