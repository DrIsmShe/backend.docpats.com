// server/modules/clinic/clinic-appointments/models/clinicAppointment.model.js
//
// One concrete appointment between a doctor and a patient at a clinic.
//
// Lifecycle:
//   scheduled  → checked_in → completed
//             ↘  cancelled
//             ↘  no_show
//
//   * scheduled  — booked but the patient hasn't arrived yet (the default
//                   on create)
//   * checked_in — patient is at the clinic; visit can start
//   * completed  — visit finished
//   * cancelled  — appointment was cancelled (by clinic or patient request)
//   * no_show    — patient didn't arrive in time
//
// Conflict detection treats `scheduled` and `checked_in` as active. The
// other three statuses free up the slot. See appointment.service.js
// (assertNoConflict) for the actual check.
//
// Timing model:
//   - startUTC / endUTC: absolute instants (Date). All conflict and
//     ordering queries use these.
//   - localDate / startMinute / endMinute: clinic-tz "calendar coords",
//     stored alongside for easy day-grouping queries ("show me Monday's
//     appointments") without re-doing tz math at read time. They are
//     authoritatively derived from startUTC/endUTC at write time and never
//     trusted from the client.
//
// PHI:
//   reasonEncrypted � patient's reason for visit / chief complaint.
//   Encrypted at-rest with ENCRYPTION_KEY (AES-256-CBC,
//   "iv:ciphertext" hex format) via encryptValue/decryptValue imported
//   from clinicPatient.model.js � single canonical crypto helper
//   (Sprint Cleanup 17.05.2026, unified across all clinic modules).
//
// Multi-tenancy:
//   tenantScopedPlugin auto-attaches clinicId to all queries — appointments
//   never leak across clinics.
//
// Soft delete:
//   softDeletePlugin adds isDeleted + deletedAt. CANCELLATION is a status
//   (not a delete) — soft-delete is for hard mistakes / GDPR erasure paths.

import mongoose from "mongoose";

import { tenantScopedPlugin } from "../../../../common/plugins/tenantScoped.plugin.js";
import { softDeletePlugin } from "../../../../common/plugins/softDelete.plugin.js";

const { Schema } = mongoose;

// ─── Constants ────────────────────────────────────────────────

export const APPOINTMENT_STATUSES = Object.freeze([
  "scheduled",
  "checked_in",
  "completed",
  "cancelled",
  "no_show",
]);

// Statuses where the doctor's time IS taken — used by conflict detection.
export const ACTIVE_STATUSES = Object.freeze(["scheduled", "checked_in"]);

// Reason text — soft cap before encryption. Keeps a single appointment doc
// from ballooning if someone pastes a wall of text.
export const REASON_MAX_LENGTH = 2000;

// ─── Sub-schemas ──────────────────────────────────────────────

// "Who created this appointment" — receptionist (employee) or
// owner/admin/doctor (DocPats user). Mirrors the actor model used in
// audit logs and clinic-patients.
const createdBySchema = new Schema(
  {
    actorType: {
      type: String,
      enum: ["user", "employee"],
      required: true,
    },
    actorId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    role: {
      type: String, // "owner" | "admin" | "receptionist" | "doctor" | ...
      required: true,
    },
  },
  { _id: false },
);

// ─── Main schema ──────────────────────────────────────────────

const clinicAppointmentSchema = new Schema(
  {
    // ─── Tenant scope (set automatically by tenantScopedPlugin) ───
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // ─── Participants ───
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "User", // DocPats user with role doctor in this clinic
      required: true,
      index: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicPatient",
      required: true,
      index: true,
    },

    // ─── Timing — absolute (canonical) ───
    startUTC: {
      type: Date,
      required: true,
      index: true, // primary ordering / conflict queries
    },
    endUTC: {
      type: Date,
      required: true,
    },

    // ─── Timing — clinic-local calendar coords (derived, denormalised) ───
    // Authoritative source is startUTC/endUTC; these are filled by the
    // service on write so day-grouping queries are cheap.
    localDate: {
      // "YYYY-MM-DD" in the clinic's timezone — the calendar day the
      // appointment STARTS on.
      type: String,
      required: true,
      index: true,
    },
    startMinute: {
      // minutes-from-local-midnight in clinic tz; 0..1439
      type: Number,
      required: true,
      min: 0,
      max: 1439,
    },
    endMinute: {
      // minutes-from-local-midnight; can exceed 1440 only if an
      // appointment crosses midnight, which is rejected by the validator,
      // so in practice 0..1440.
      type: Number,
      required: true,
      min: 1,
      max: 1440,
    },

    // ─── PHI — reason / chief complaint (encrypted) ───
    // "iv:ciphertext" hex via ENCRYPTION_KEY (CBC). May be empty
    // (the visit reason isn't always recorded at booking).
    reasonEncrypted: {
      type: String,
      default: null,
    },

    // ─── Lifecycle ───
    status: {
      type: String,
      enum: APPOINTMENT_STATUSES,
      default: "scheduled",
      required: true,
      index: true,
    },

    // Audit-style timestamps for status transitions. Filled by the service.
    checkedInAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null, maxlength: 500 },
    noShowAt: { type: Date, default: null },

    // ─── Provenance ───
    createdBy: { type: createdBySchema, required: true },
  },
  {
    timestamps: true,
    collection: "clinic_appointments",
  },
);

// ─── Indexes ──────────────────────────────────────────────────
//
// Goal: cheap queries for the three hot read paths.
//   1. doctor's day:     clinicId + doctorId + localDate
//   2. patient history:  clinicId + patientId + startUTC (most recent first)
//   3. conflict check:   clinicId + doctorId + startUTC + status
//
// clinicId is auto-prepended by tenantScopedPlugin on queries; included
// explicitly in the compound indexes so the index serves the actual query
// shape sent to Mongo.

clinicAppointmentSchema.index({ clinicId: 1, doctorId: 1, localDate: 1 });
clinicAppointmentSchema.index({ clinicId: 1, patientId: 1, startUTC: -1 });
// Partial: only active appointments need to participate in conflict
// detection. Cuts the index in half on long-running clinics.
clinicAppointmentSchema.index(
  { clinicId: 1, doctorId: 1, startUTC: 1, endUTC: 1 },
  {
    partialFilterExpression: {
      status: { $in: ["scheduled", "checked_in"] },
    },
    name: "doctor_active_overlap",
  },
);

// ─── Plugins ──────────────────────────────────────────────────
clinicAppointmentSchema.plugin(tenantScopedPlugin);
clinicAppointmentSchema.plugin(softDeletePlugin);

// ─── Sanity check pre-save ────────────────────────────────────
// Backstop: even if a caller bypasses the validator, an appointment with
// end <= start should never hit the DB.
clinicAppointmentSchema.pre("validate", function (next) {
  if (
    this.startUTC &&
    this.endUTC &&
    this.endUTC.getTime() <= this.startUTC.getTime()
  ) {
    return next(new Error("endUTC must be after startUTC"));
  }
  if (
    typeof this.startMinute === "number" &&
    typeof this.endMinute === "number" &&
    this.endMinute <= this.startMinute
  ) {
    return next(new Error("endMinute must be after startMinute"));
  }
  next();
});

// ─── Model (idempotent in case of repeated imports) ───────────
const ClinicAppointment =
  mongoose.models.ClinicAppointment ||
  mongoose.model("ClinicAppointment", clinicAppointmentSchema);

export default ClinicAppointment;
