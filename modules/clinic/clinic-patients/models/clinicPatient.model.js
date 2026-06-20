// server/modules/clinic/clinic-patients/models/clinicPatient.model.js
//
// Patient record owned by a clinic.
//
// Encryption strategy (unified with rest of DocPats — Sprint Cleanup 17.05.2026):
//   - PHI fields (firstName, lastName, phone, email, notes) are encrypted
//     at rest using ENCRYPTION_KEY (legacy 16-byte key padded to 32 bytes,
//     AES-256-CBC). Same algorithm as User model, clinicEmployee, etc.
//   - Storage format: "iv:ciphertext" (all hex, 2 parts).
//   - We additionally store SHA-256 HMAC hashes of phone and email to enable
//     deterministic equality search WITHOUT decrypting every record
//     (blind index pattern). HMAC pepper = same ENCRYPTION_KEY (32 bytes
//     padded). Same input ALWAYS produces same hash.
//   - First/last name are NOT hashed — search by name does decrypt-then-
//     filter inside the clinic scope (small N, acceptable).
//
// HIPAA §164.312(a)(2)(iv): PHI encrypted at rest. ✓
// Multi-tenancy: tenantScoped plugin enforces clinicId on every query.

import mongoose from "mongoose";
import crypto from "crypto";
import { tenantScopedPlugin } from "../../../../common/plugins/tenantScoped.plugin.js";
import { softDeletePlugin } from "../../../../common/plugins/softDelete.plugin.js";

const { Schema } = mongoose;

// ─── Crypto helpers ────────────────────────────────────────────────────

const ALGO = "aes-256-cbc";
const RAW_KEY = process.env.ENCRYPTION_KEY || "";

if (!RAW_KEY) {
  // Defensive: catch misconfiguration at boot, not at first patient create.
  throw new Error(
    "[clinicPatient.model] ENCRYPTION_KEY must be set in environment",
  );
}

// Pad/truncate to exactly 32 bytes — same approach as User model
// (consistency across the codebase: ENCRYPTION_KEY may be 16 chars in
// .env, padded to 32 for AES-256-CBC).
const KEY = Buffer.from(RAW_KEY.padEnd(32, "0").slice(0, 32), "utf8");

/**
 * Encrypt a string to "iv:ciphertext" (all hex).
 * Returns null for null/undefined/empty input — never throws on absence.
 */
export function encryptValue(plain) {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * Decrypt "iv:ciphertext" back to plaintext.
 * Returns null for null/undefined/malformed input — never throws (caller
 * decides what to do with null).
 */
export function decryptValue(payload) {
  if (!payload || typeof payload !== "string") return null;
  const parts = payload.split(":");
  if (parts.length !== 2) return null;
  try {
    const [ivHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Deterministic HMAC-SHA256 hash with the encryption key as pepper.
 * Used for blind-index search on phone/email — same input ALWAYS produces
 * same hash, so we can do exact-match queries without decrypting all records.
 *
 * Input is normalized (trim + lowercase) before hashing so search is
 * case/whitespace insensitive.
 */
export function hashValue(plain) {
  if (plain === null || plain === undefined || plain === "") return null;
  const normalized = String(plain).trim().toLowerCase();
  return crypto.createHmac("sha256", KEY).update(normalized).digest("hex");
}

// ─── Schema ────────────────────────────────────────────────────────────

const clinicPatientSchema = new Schema(
  {
    // tenantScoped plugin requires this — every query is filtered by it
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // ─── PHI (encrypted) ───
    firstNameEncrypted: { type: String, required: true },
    lastNameEncrypted: { type: String, required: true },
    phoneEncrypted: { type: String, default: null },
    emailEncrypted: { type: String, default: null },

    // ─── Blind indexes (for exact-match search) ───
    phoneHash: { type: String, default: null, index: true },
    emailHash: { type: String, default: null, index: true },

    // ─── Non-PHI demographics ───
    dateOfBirth: { type: Date, default: null },
    gender: {
      type: String,
      enum: ["male", "female", "other", "unknown", null],
      default: null,
    },

    // ─── Org structure ───
    // Primary department this patient is attached to (optional).
    // Validated against the clinic's active departments in the service
    // layer (assertDepartmentInClinic). null = unassigned.
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicDepartment",
      default: null,
      index: true,
    },

    // ─── Link to existing DocPats user account (optional) ───
    // If the patient is a registered DocPats user, we link by _id.
    // This enables future features: shared dialogs, patient-side portal, etc.
    linkedUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // ─── Free-form clinical/admin notes (encrypted) ───
    notesEncrypted: { type: String, default: null },

    // ─── Audit fields ───
    // Actor can live in either User or ClinicEmployee — we don't enforce ref.
    createdBy: { type: Schema.Types.ObjectId, required: true },
    createdByType: {
      type: String,
      enum: ["user", "employee"],
      required: true,
    },
    lastUpdatedBy: { type: Schema.Types.ObjectId, default: null },
    lastVisitAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "clinic_patients",
  },
);

// ─── Indexes ──────────────────────────────────────────────────────────

// Compound: list patients within a clinic, newest first
clinicPatientSchema.index({ clinicId: 1, createdAt: -1 });

// Compound: phone lookup within a clinic (most common search)
clinicPatientSchema.index({ clinicId: 1, phoneHash: 1 });

// Compound: email lookup within a clinic
clinicPatientSchema.index({ clinicId: 1, emailHash: 1 });

// Compound: list patients attached to a department within a clinic
clinicPatientSchema.index({ clinicId: 1, departmentId: 1 });

// Compound: find linked patients (e.g. when a DocPats user logs in,
// show them which clinics they're registered at)
clinicPatientSchema.index({ linkedUserId: 1, clinicId: 1 });

// ─── Plugins ──────────────────────────────────────────────────────────

clinicPatientSchema.plugin(tenantScopedPlugin);
clinicPatientSchema.plugin(softDeletePlugin);

// ─── Virtuals (decrypted views) ───────────────────────────────────────
//
// IMPORTANT: virtuals are NOT included in .lean() results. Service layer
// must call decryptValue() explicitly when using lean queries (which we
// always do for performance). These virtuals exist only as a convenience
// for non-lean code paths (e.g. tests, direct model usage).

clinicPatientSchema.virtual("firstName").get(function () {
  return decryptValue(this.firstNameEncrypted);
});
clinicPatientSchema.virtual("lastName").get(function () {
  return decryptValue(this.lastNameEncrypted);
});
clinicPatientSchema.virtual("phone").get(function () {
  return decryptValue(this.phoneEncrypted);
});
clinicPatientSchema.virtual("email").get(function () {
  return decryptValue(this.emailEncrypted);
});
clinicPatientSchema.virtual("notes").get(function () {
  return decryptValue(this.notesEncrypted);
});

// ─── Hide encrypted fields from JSON output ──────────────────────────
//
// Without this, API responses would include both `firstName` (virtual,
// decrypted) and `firstNameEncrypted` (raw). We only want the decrypted
// version to leak through serialization.

clinicPatientSchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.firstNameEncrypted;
    delete ret.lastNameEncrypted;
    delete ret.phoneEncrypted;
    delete ret.emailEncrypted;
    delete ret.notesEncrypted;
    delete ret.phoneHash;
    delete ret.emailHash;
    return ret;
  },
});
clinicPatientSchema.set("toObject", { virtuals: true });

// ─── Model export (safe for hot reload / multiple imports) ──────────

const ClinicPatient =
  mongoose.models.ClinicPatient ||
  mongoose.model("ClinicPatient", clinicPatientSchema);

export default ClinicPatient;
