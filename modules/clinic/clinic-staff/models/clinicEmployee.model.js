// modules/clinic/clinic-staff/models/clinicEmployee.model.js
//
// GLOBAL clinic worker identity (non-DocPats-user staff): nurses,
// receptionists, accountants, pharmacists, marketers, etc.
//
// IMPORTANT — identity model (Global Clinic Worker):
// - A ClinicEmployee is ONE global identity across the whole system,
//   keyed by a globally-unique emailHash. One person = one record = one
//   login, regardless of how many clinics they work in.
// - The link to a clinic (which clinic, which role, hire/leave dates) lives
//   in ClinicMembership (actorType: "employee"), NOT here. Hiring creates a
//   membership; a clinic "firing" a worker sets membership.leftAt — it does
//   NOT touch or delete this identity.
// - Only the PLATFORM OWNER may delete the identity itself
//   (isPlatformDeleted), never a clinic.
// - ClinicEmployees are NOT DocPats Users: no public profile, no patient
//   cabinet, login via the separate staff endpoint only.
//
// The SAME email may exist BOTH as a User (patient/doctor) and as a
// ClinicEmployee — they are deliberately separate identities and are not
// linked. Uniqueness here is scoped to this collection only.
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
    // NOTE: clinicId and role intentionally REMOVED from the identity.
    // They now live in ClinicMembership (one per clinic the worker is in).
    // This identity is clinic-agnostic and globally unique by emailHash.

    // Encrypted PII
    emailEncrypted: { type: String, required: true },
    // Globally unique across the whole system (one identity per email).
    emailHash: { type: String, required: true, unique: true, index: true },
    firstNameEncrypted: { type: String, required: true },
    lastNameEncrypted: { type: String, required: true },
    phoneNumberEncrypted: { type: String, default: null },

    // Auth — argon2 hash, NOT encrypted (one-way)
    passwordHash: { type: String, required: true },

    customTitle: { type: String, trim: true, maxlength: 200 },

    // Identity-level active flag (login enabled). This is NOT per-clinic
    // employment status — that is ClinicMembership.leftAt.
    isActive: { type: Boolean, default: true, index: true },
    isBlocked: { type: Boolean, default: false },
    blockedReason: { type: String, default: null },

    // Who first invited / on which invitation (historical origin)
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
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

    // ─── Восстановление пароля (ссылка + код из одного письма) ───
    // В БД хранится ТОЛЬКО sha256 от токена — сам токен живёт лишь в письме.
    // Тот же приём, что у StaffInvitation.tokenHash.
    // Код хешируется ВМЕСТЕ с хешем токена — sha256(`${код}:${хеш_токена}`), —
    // поэтому ни ссылка без кода, ни код без ссылки по отдельности не работают.
    passwordResetTokenHash: { type: String, default: null, index: true },
    passwordResetOtpHash: { type: String, default: null },
    // Срок жизни ссылки и кода — 30 минут.
    passwordResetExpiresAt: { type: Date, default: null },
    // Сколько попыток ввода кода осталось (даём 3). Кончились — ссылка сгорает.
    passwordResetAttemptsLeft: { type: Number, default: 0 },
    // Когда сброс запрашивали в последний раз — для кулдауна в 60 секунд.
    passwordResetRequestedAt: { type: Date, default: null },

    // Когда пароль меняли в последний раз (для интерфейса и аудита).
    lastPasswordChangeAt: { type: Date, default: null },
    // Требовать смену пароля при следующем входе (если пароль выдал админ).
    mustChangePassword: { type: Boolean, default: false },

    preferredLanguage: {
      type: String,
      enum: SUPPORTED_LANGUAGES,
      default: "ru",
    },

    // PLATFORM-LEVEL delete — only the platform owner may set this.
    // A clinic firing a worker does NOT touch these (it sets
    // ClinicMembership.leftAt instead). The identity stays intact so the
    // worker can still be hired by other clinics and keep their login.
    isPlatformDeleted: { type: Boolean, default: false, index: true },
    platformDeletedAt: { type: Date, default: null },
    platformDeletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
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
    // Хеши сброса пароля наружу не отдаём никогда.
    delete ret.passwordResetTokenHash;
    delete ret.passwordResetOtpHash;
    return ret;
  },
});

const ClinicEmployee =
  mongoose.models.ClinicEmployee ||
  mongoose.model("ClinicEmployee", clinicEmployeeSchema);

export default ClinicEmployee;
export { encryptValue, decryptValue, sha256, normalizeEmail };
