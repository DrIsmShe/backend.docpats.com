// modules/clinic/clinic-staff/models/staffInvitation.model.js
//
// Staff invitations sent by clinic owners/admins to invite new internal
// employees (nurses, receptionists, accountants, etc.) who don't yet have
// any DocPats account. After accepting, recipient gets a ClinicEmployee
// record + ClinicMembership.
//
// Lifecycle: pending → accepted | revoked | expired

import mongoose from "mongoose";
import crypto from "crypto";

const RAW_KEY = process.env.ENCRYPTION_KEY || "";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

const isEncrypted = (v) => typeof v === "string" && v.includes(":");

function encryptValue(value) {
  if (value == null) return value;
  const s = String(value);
  if (!s) return s;
  if (isEncrypted(s)) return s;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    iv,
  );
  const encrypted = Buffer.concat([cipher.update(s, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptValue(value) {
  if (value == null) return value;
  const s = String(value);
  if (!isEncrypted(s)) return s;
  try {
    const [ivHex, dataHex] = s.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(ivHex, "hex"),
    );
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

const sha256 = (v) =>
  v == null ? v : crypto.createHash("sha256").update(String(v)).digest("hex");

const normalizeEmail = (v) => (v == null ? v : String(v).trim().toLowerCase());

const SUPPORTED_LANGUAGES = ["ru", "en", "tr", "az", "ar"];

const STATUSES = ["pending", "accepted", "revoked", "expired"];

const staffInvitationSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // Email — encrypted at rest, hashed for unique lookups
    emailEncrypted: { type: String, required: true },
    emailHash: { type: String, required: true, index: true },

    role: { type: String, required: true },
    customTitle: { type: String, trim: true, maxlength: 200 },

    // Token: only the SHA-256 hash is stored; the actual signed token is
    // sent in the email and never persisted. We verify by hashing again.
    tokenHash: { type: String, required: true, unique: true, index: true },

    status: {
      type: String,
      enum: STATUSES,
      default: "pending",
      index: true,
    },

    expiresAt: { type: Date, required: true, index: true },

    // OTP for confirming email ownership during registration
    otpHash: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },
    otpAttemptsLeft: { type: Number, default: 3, min: 0 },
    otpRequestedAt: { type: Date, default: null },

    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    acceptedAt: { type: Date, default: null },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicEmployee",
      default: null,
    },
    revokedAt: { type: Date, default: null },
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    language: {
      type: String,
      enum: SUPPORTED_LANGUAGES,
      default: "ru",
    },
  },
  { timestamps: true },
);

// Compound unique index: only ONE pending invitation per (clinic, email).
// Once accepted/revoked/expired, the email is free for another invite.
staffInvitationSchema.index(
  { clinicId: 1, emailHash: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  },
);

// Pre-validate: encrypt email + compute hash
staffInvitationSchema.pre("validate", function (next) {
  if (this.isModified("emailEncrypted") && this.emailEncrypted) {
    // Compute hash from plaintext BEFORE encryption (or from already-set plain value)
    const plain = isEncrypted(this.emailEncrypted)
      ? decryptValue(this.emailEncrypted)
      : this.emailEncrypted;
    if (plain) {
      this.emailHash = sha256(normalizeEmail(plain));
    }
    this.emailEncrypted = encryptValue(this.emailEncrypted);
  }
  next();
});

// Helper to read decrypted email
staffInvitationSchema.methods.getEmail = function () {
  return decryptValue(this.emailEncrypted);
};

// Helper for filtering: find pending and not-expired
staffInvitationSchema.statics.findActivePending = function (filter = {}) {
  return this.find({
    ...filter,
    status: "pending",
    expiresAt: { $gt: new Date() },
  });
};

// Hide sensitive fields from JSON output
staffInvitationSchema.set("toJSON", {
  transform: (_, ret) => {
    delete ret.emailEncrypted;
    delete ret.tokenHash;
    delete ret.otpHash;
    return ret;
  },
});

const StaffInvitation =
  mongoose.models.StaffInvitation ||
  mongoose.model("StaffInvitation", staffInvitationSchema);

export default StaffInvitation;
export { encryptValue, decryptValue, sha256, normalizeEmail };
