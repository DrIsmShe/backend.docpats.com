// modules/clinic/clinic-staff/models/clinicEmployee.model.js
//
// Internal clinic staff (non-DocPats users): nurses, receptionists,
// accountants, pharmacists, marketers, etc.
//
// IMPORTANT: ClinicEmployee is a SEPARATE collection from User.
// - DocPats Users (User collection): doctors, patients — public profile,
//   visible across the platform.
// - ClinicEmployees (this collection): visible ONLY within their clinic,
//   no public profile, login via separate endpoint.
//
// PII fields are encrypted at rest with AES-256-CBC using ENCRYPTION_KEY
// (same standard as User model).

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

const clinicEmployeeSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // Encrypted PII
    emailEncrypted: { type: String, required: true },
    emailHash: { type: String, required: true, unique: true, index: true },
    firstNameEncrypted: { type: String, required: true },
    lastNameEncrypted: { type: String, required: true },
    phoneNumberEncrypted: { type: String, default: null },

    // Auth — argon2 hash, NOT encrypted (one-way)
    passwordHash: { type: String, required: true },

    // Role inside the clinic — MUST match one of the internal roles
    // (not "owner", "doctor", "patient" — those are User-tied)
    role: {
      type: String,
      required: true,
      enum: [
        "admin",
        "manager",
        "nurse",
        "receptionist",
        "accountant",
        "pharmacist",
        "marketer",
      ],
    },

    customTitle: { type: String, trim: true, maxlength: 200 },

    isActive: { type: Boolean, default: true, index: true },
    isBlocked: { type: Boolean, default: false },
    blockedReason: { type: String, default: null },

    // Who invited / accepted on which invitation
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    invitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffInvitation",
      default: null,
    },
    joinedAt: { type: Date, default: Date.now },
    lastLoginAt: { type: Date, default: null },

    failedLoginAttempts: { type: Number, default: 0 },
    lockoutUntil: { type: Date, default: null },

    preferredLanguage: {
      type: String,
      enum: SUPPORTED_LANGUAGES,
      default: "ru",
    },

    // Soft delete
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Pre-validate: encrypt PII + compute email hash from plaintext
clinicEmployeeSchema.pre("validate", function (next) {
  if (this.isModified("emailEncrypted") && this.emailEncrypted) {
    const plain = isEncrypted(this.emailEncrypted)
      ? decryptValue(this.emailEncrypted)
      : this.emailEncrypted;
    if (plain) {
      this.emailHash = sha256(normalizeEmail(plain));
    }
    this.emailEncrypted = encryptValue(this.emailEncrypted);
  }
  if (this.isModified("firstNameEncrypted") && this.firstNameEncrypted) {
    this.firstNameEncrypted = encryptValue(this.firstNameEncrypted);
  }
  if (this.isModified("lastNameEncrypted") && this.lastNameEncrypted) {
    this.lastNameEncrypted = encryptValue(this.lastNameEncrypted);
  }
  if (this.isModified("phoneNumberEncrypted") && this.phoneNumberEncrypted) {
    this.phoneNumberEncrypted = encryptValue(this.phoneNumberEncrypted);
  }
  next();
});

// Helper: get all decrypted PII at once
clinicEmployeeSchema.methods.decryptFields = function () {
  return {
    email: decryptValue(this.emailEncrypted),
    firstName: decryptValue(this.firstNameEncrypted),
    lastName: decryptValue(this.lastNameEncrypted),
    phoneNumber: this.phoneNumberEncrypted
      ? decryptValue(this.phoneNumberEncrypted)
      : null,
  };
};

// Hide sensitive fields from JSON output by default
clinicEmployeeSchema.set("toJSON", {
  transform: (_, ret) => {
    delete ret.emailEncrypted;
    delete ret.emailHash;
    delete ret.firstNameEncrypted;
    delete ret.lastNameEncrypted;
    delete ret.phoneNumberEncrypted;
    delete ret.passwordHash;
    return ret;
  },
});

const ClinicEmployee =
  mongoose.models.ClinicEmployee ||
  mongoose.model("ClinicEmployee", clinicEmployeeSchema);

export default ClinicEmployee;
export { encryptValue, decryptValue, sha256, normalizeEmail };
