// server/modules/auth/services/provisionalOtp.service.js
//
// Two-step activation flow for provisional User accounts.
//
// State storage: User document (matches the pattern used by ordinary
// registration's User.otp / User.childOtp / User.parentOtp). Plain-text
// 6-digit code, visible in Mongo Compass for debugging when email
// delivery has issues.
//
//   STEP 1 — requestActivationOtp({ userId, newEmail, newPassword })
//     - validates input (email format, password strength, uniqueness)
//     - computes argon2 hash of newPassword
//     - generates 6-digit OTP
//     - stores activationOtp + activationOtpExpiresAt +
//       pendingNewEmailEncrypted + pendingNewPasswordHash on User
//     - sends OTP via email to the NEW address (the patient must prove
//       they own it)
//     - returns { emailMasked } for the UI
//
//   STEP 2 — confirmActivationOtp({ userId, otp })
//     - loads User, checks expiry / max attempts / code match
//     - on success: applies pendingNewEmail + pendingNewPasswordHash to
//       User, sets isProvisional=false, clears ALL activation* +
//       pendingNew* fields, returns user DTO
//
//   RESEND — resendActivationOtp({ userId })
//     - regenerates code, re-sends, resets attempts counter
//     - rate-limited to 1/min via activationOtpLastSentAt
//
// All state persists on the User document — survives across tab
// closures within the 10-minute TTL window. Cleared on successful
// activation or via cron (out of scope; TTL alone is enough for now).

import argon2 from "argon2";
import crypto from "crypto";
import mongoose from "mongoose";

import User, { decrypt } from "../../../common/models/Auth/users.js";
import { sendEmail } from "./emailService.js";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
} from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

const log = logger.child({ module: "auth/provisional-otp" });

// ─── Local encryption mirror of users.js encrypt/decrypt ─────────────
//
// users.js exports `decrypt` but NOT `encrypt`, so we replicate it
// here with IDENTICAL algorithm + key derivation. The encrypted value
// MUST be readable by User.decrypt later.
//
// Algorithm: AES-256-CBC, key = ENCRYPTION_KEY padded/sliced to 32
// chars, format = "ivHex:ciphertextHex". Mirrors users.js lines 22-39.

const ENCRYPTION_RAW_KEY = process.env.ENCRYPTION_KEY || "";
const ENCRYPTION_SECRET_KEY = ENCRYPTION_RAW_KEY.padEnd(32, "0").slice(0, 32);

function encrypt(value) {
  if (value == null) return value;
  const s = String(value);
  if (!s) return s;
  // Idempotency guard — same as users.js. Avoids double-encrypt.
  if (typeof s === "string" && s.includes(":")) return s;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_SECRET_KEY),
    iv,
  );
  const encrypted = Buffer.concat([cipher.update(s, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

// ─── Constants ────────────────────────────────────────────────────────

const MIN_PASSWORD_LENGTH = 8;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between resends
const OTP_LENGTH = 6;

// Retry-on-transient-failure config for SMTP send. Brevo occasionally
// drops the TCP socket under throttle or after idle; nodemailer's
// global transporter doesn't auto-reconnect within the same call.
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNECTION",
  "ESOCKET",
  "EAI_AGAIN",
]);
const MAX_SEND_ATTEMPTS = 3;

const normalizeEmail = (v) => String(v).trim().toLowerCase();
const sha256 = (v) =>
  crypto.createHash("sha256").update(String(v)).digest("hex");

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Generate a 6-digit OTP code using crypto-grade randomness.
 * Range: 100000..999999 (always 6 digits, no leading zeros).
 */
function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Mask an email for display: "ismayil@docpats.com" → "ism***@docpats.com"
 */
function maskEmail(email) {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, 3);
  return `${visible}***@${domain}`;
}

/**
 * Safely decrypt a pendingNewEmailEncrypted field (handles null + errors).
 */
function safeDecryptPendingEmail(encrypted) {
  if (!encrypted) return null;
  try {
    return decrypt(encrypted) || null;
  } catch (err) {
    log.warn(
      { err: err.message },
      "Failed to decrypt pendingNewEmailEncrypted",
    );
    return null;
  }
}

/**
 * Send the OTP email.
 *
 * Wraps sendEmail with a retry loop on transient network errors.
 * Permanent failures (auth, bad recipient) are thrown immediately.
 */
async function sendOtpEmail({ to, code }) {
  const subject = `Your OTP Code: ${code}`;
  const text = `Your DocPats verification code is: ${code}\n\nThe code expires in 10 minutes.`;

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      await sendEmail(to, subject, text);
      if (attempt > 1) {
        log.info(
          { attempt, emailMasked: maskEmail(to) },
          "OTP email sent after retry",
        );
      }
      return;
    } catch (err) {
      lastErr = err;
      const errCode = err?.code || err?.cause?.code;
      const isTransient = TRANSIENT_ERROR_CODES.has(errCode);

      log.warn(
        {
          attempt,
          maxAttempts: MAX_SEND_ATTEMPTS,
          errCode: errCode || null,
          errMsg: err?.message,
          isTransient,
        },
        "OTP email send attempt failed",
      );

      if (!isTransient || attempt === MAX_SEND_ATTEMPTS) throw err;
      const delayMs = 500 * Math.pow(3, attempt - 1);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/**
 * Load and validate that a user is in a state where activation can proceed.
 */
async function loadActivatableUser(userId) {
  if (!userId || !mongoose.isValidObjectId(userId)) {
    throw new ValidationError("Invalid session user");
  }
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User");
  if (!user.isProvisional) {
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
  return user;
}

/**
 * Clear all activation/pending fields on a User document.
 * Called after successful activation OR on rollback (failed send).
 */
function clearActivationFields(user) {
  user.activationOtp = null;
  user.activationOtpExpiresAt = null;
  user.activationOtpAttempts = 0;
  user.activationOtpLastSentAt = null;
  user.pendingNewEmailEncrypted = null;
  user.pendingNewPasswordHash = null;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * STEP 1: validate inputs, persist pending state on User, send OTP.
 *
 * Does NOT modify the User's email/password yet — those changes happen
 * only after the patient proves ownership of newEmail by entering the OTP.
 */
export async function requestActivationOtp({ userId, newEmail, newPassword }) {
  if (typeof newEmail !== "string" || !newEmail.trim()) {
    throw new ValidationError("newEmail is required", { field: "newEmail" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    throw new ValidationError("Invalid email format", { field: "newEmail" });
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

  const user = await loadActivatableUser(userId);

  // Uniqueness check via emailHash (same blind index as everywhere else)
  const normalized = normalizeEmail(newEmail);
  const newEmailHash = sha256(normalized);

  if (newEmailHash === user.emailHash) {
    throw new ValidationError(
      "New email must differ from your temporary email",
      { field: "newEmail" },
    );
  }
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

  // Hash the password once now. We store the hash (not plaintext) on
  // the User document — even if DB leaks, the password is not
  // recoverable.
  const passwordHash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
  });

  const otpCode = generateOtpCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

  // Persist pending activation state on User document.
  // Plain-text OTP — visible in Mongo Compass, matches ordinary
  // registration's User.otp pattern.
  user.activationOtp = otpCode;
  user.activationOtpExpiresAt = expiresAt;
  user.activationOtpAttempts = 0;
  user.activationOtpLastSentAt = now;
  user.pendingNewEmailEncrypted = encrypt(normalized);
  user.pendingNewPasswordHash = passwordHash;

  await user.save();

  // ─── Dev-only: log the OTP to console so we can test the flow
  //              without depending on email delivery.
  if (process.env.NODE_ENV !== "production") {
    log.warn(
      { otpCode, emailMasked: maskEmail(normalized) },
      "🔓 DEV: OTP code (remove from logs in production)",
    );
    console.log("");
    console.log("================================================");
    console.log(`  🔓 OTP CODE: ${otpCode}  (for ${normalized})`);
    console.log("================================================");
    console.log("");
  }

  try {
    await sendOtpEmail({ to: normalized, code: otpCode });
  } catch (err) {
    log.error(
      { err: err.message, userId: String(user._id) },
      "Failed to send activation OTP",
    );
    // Roll back the pending state on send failure — we don't want a
    // "stuck" pending state with no email delivered.
    clearActivationFields(user);
    try {
      await user.save();
    } catch (rollbackErr) {
      log.error(
        { rollbackErr: rollbackErr.message },
        "Failed to rollback activation fields after send failure",
      );
    }
    const detail = err?.message || "unknown";
    throw new Error(`Failed to send OTP email: ${detail}`);
  }

  log.info(
    {
      userId: String(user._id),
      emailMasked: maskEmail(normalized),
    },
    "Provisional activation OTP requested",
  );

  return { emailMasked: maskEmail(normalized) };
}

/**
 * STEP 2: verify OTP, apply changes to User, clear pending state.
 */
export async function confirmActivationOtp({ userId, otp }) {
  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    throw new ValidationError("OTP must be a 6-digit code", { field: "otp" });
  }

  const user = await loadActivatableUser(userId);

  if (!user.activationOtp || !user.pendingNewEmailEncrypted) {
    throw new ValidationError(
      "No pending activation found. Please start over.",
      { code: "no_pending" },
    );
  }

  if (
    user.activationOtpExpiresAt &&
    Date.now() > new Date(user.activationOtpExpiresAt).getTime()
  ) {
    clearActivationFields(user);
    await user.save();
    throw new ValidationError(
      "OTP code has expired. Please request a new one.",
      { code: "otp_expired" },
    );
  }

  if (user.activationOtpAttempts >= OTP_MAX_ATTEMPTS) {
    clearActivationFields(user);
    await user.save();
    throw new ForbiddenError(
      "Too many incorrect attempts. Please request a new code.",
      { code: "too_many_attempts" },
    );
  }

  // Constant-time comparison — defence against timing attacks.
  // crypto.timingSafeEqual requires equal-length buffers, so we hash
  // both sides to a fixed size.
  const a = sha256(otp);
  const b = sha256(user.activationOtp);
  const ok = crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  if (!ok) {
    user.activationOtpAttempts += 1;
    const remaining = OTP_MAX_ATTEMPTS - user.activationOtpAttempts;
    await user.save();
    throw new ValidationError(
      `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
      { code: "otp_invalid", attemptsRemaining: remaining },
    );
  }

  // OK — decrypt pending email + verify still unique
  const pendingEmail = safeDecryptPendingEmail(user.pendingNewEmailEncrypted);
  if (!pendingEmail) {
    clearActivationFields(user);
    await user.save();
    throw new ValidationError(
      "Pending activation data corrupted. Please start over.",
      { code: "no_pending" },
    );
  }

  const newEmailHash = sha256(pendingEmail);
  const conflict = await User.findOne({
    emailHash: newEmailHash,
    _id: { $ne: user._id },
    isAnonymized: { $ne: true },
  })
    .select("_id")
    .lean();
  if (conflict) {
    clearActivationFields(user);
    await user.save();
    throw new ConflictError(
      "This email was registered by someone else. Please use a different email.",
      { field: "newEmail" },
    );
  }

  // Apply changes — pre-save hook re-encrypts emailEncrypted and
  // recomputes emailHash automatically when we set plaintext on
  // emailEncrypted.
  user.emailEncrypted = pendingEmail;
  user.password = user.pendingNewPasswordHash;
  user.isProvisional = false;
  user.mustCompleteRegistration = false;
  user.mustChangePassword = false;
  user.provisionalExpiresAt = null;
  user.lastPasswordChangeAt = new Date();
  user.registeredAt = new Date();

  // Clear all activation-related fields
  clearActivationFields(user);

  await user.save();

  log.info(
    {
      userId: String(user._id),
      provisionalCreatedBy: user.provisionalCreatedBy
        ? String(user.provisionalCreatedBy)
        : null,
    },
    "Provisional user activated via OTP",
  );

  return { user: user.toJSON() };
}

/**
 * Re-send OTP to the same pending email.
 * Resets the attempts counter and the expiry timer, but keeps the
 * pending email + password hash unchanged (patient already typed them).
 */
export async function resendActivationOtp({ userId }) {
  const user = await loadActivatableUser(userId);

  if (!user.pendingNewEmailEncrypted || !user.pendingNewPasswordHash) {
    throw new ValidationError(
      "No pending activation found. Please start over.",
      { code: "no_pending" },
    );
  }

  const now = Date.now();
  const lastSentMs = user.activationOtpLastSentAt
    ? new Date(user.activationOtpLastSentAt).getTime()
    : 0;

  if (lastSentMs && now - lastSentMs < OTP_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil(
      (OTP_RESEND_COOLDOWN_MS - (now - lastSentMs)) / 1000,
    );
    throw new ValidationError(
      `Please wait ${wait} second${wait === 1 ? "" : "s"} before requesting a new code.`,
      { code: "resend_cooldown", retryAfterSeconds: wait },
    );
  }

  const pendingEmail = safeDecryptPendingEmail(user.pendingNewEmailEncrypted);
  if (!pendingEmail) {
    clearActivationFields(user);
    await user.save();
    throw new ValidationError(
      "Pending activation data corrupted. Please start over.",
      { code: "no_pending" },
    );
  }

  const otpCode = generateOtpCode();
  const expiresAt = new Date(now + OTP_TTL_MS);

  user.activationOtp = otpCode;
  user.activationOtpExpiresAt = expiresAt;
  user.activationOtpAttempts = 0;
  user.activationOtpLastSentAt = new Date(now);
  await user.save();

  if (process.env.NODE_ENV !== "production") {
    log.warn(
      { otpCode, emailMasked: maskEmail(pendingEmail) },
      "🔓 DEV: OTP code (resent)",
    );
    console.log("");
    console.log("================================================");
    console.log(`  🔓 OTP CODE (resent): ${otpCode}  (for ${pendingEmail})`);
    console.log("================================================");
    console.log("");
  }

  try {
    await sendOtpEmail({ to: pendingEmail, code: otpCode });
  } catch (err) {
    log.error({ err: err.message }, "Failed to resend activation OTP");
    const detail = err?.message || "unknown";
    throw new Error(`Failed to resend OTP: ${detail}`);
  }

  log.info(
    {
      userId: String(user._id),
      emailMasked: maskEmail(pendingEmail),
    },
    "Provisional activation OTP resent",
  );

  return { emailMasked: maskEmail(pendingEmail) };
}

export default {
  requestActivationOtp,
  confirmActivationOtp,
  resendActivationOtp,
};

// Exposed for tests
export const __test__ = {
  generateOtpCode,
  maskEmail,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
};
