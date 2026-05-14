// server/modules/clinic/clinic-appointments/models/clinicScheduleException.model.js
//
// Per-DATE override of a doctor's weekly schedule, within a clinic.
//
// Relationship to ClinicDoctorSchedule:
//   ClinicDoctorSchedule = the RECURRING weekly pattern (every Monday 09–18…).
//   ClinicScheduleException = a ONE-OFF deviation for a SPECIFIC calendar date:
//     - type "day_off"  → doctor does NOT work that date at all
//                         (vacation, sick day, public holiday, …).
//                         `intervals` is ignored / empty.
//     - type "custom"   → doctor works that date, but with DIFFERENT hours
//                         than the weekly pattern would give. `intervals`
//                         fully REPLACES whatever the weekday pattern said.
//
//   Slot generation (Day 3) resolves a date like this:
//     1. look for an exception on that exact date
//     2. if type "day_off"  → no slots
//        if type "custom"   → use exception.intervals
//        if no exception    → fall back to the weekly pattern for that weekday
//
// Date handling — IMPORTANT:
//   `date` is stored as a UTC Date pinned to MIDNIGHT of the clinic-local
//   calendar day it represents. We do NOT store a time-of-day here — the
//   date is a pure calendar marker ("2026-05-20 in this clinic's timezone").
//   The clinic's IANA timezone lives on the Clinic model (Clinic.timezone);
//   the service layer is responsible for converting an incoming "YYYY-MM-DD"
//   string into the correct UTC-midnight Date for that clinic before saving,
//   and for comparing dates in the clinic's local frame. Storing a normalized
//   UTC-midnight value keeps exact-date equality queries trivial and immune
//   to the server's own timezone.
//
//   `intervals` reuse the SAME representation as ClinicDoctorSchedule:
//   minutes-from-local-midnight (0–1440), validated start < end, no overlap.
//
// Not PHI — a doctor's day off is not protected health information. No
// field-level encryption. tenantScoped + softDelete for consistency with
// the rest of the clinic module.
//
// Fully isolated from the legacy per-doctor appointments module: separate
// collection (clinic_schedule_exceptions), separate model.

import mongoose from "mongoose";
import { tenantScopedPlugin } from "../../../../common/plugins/tenantScoped.plugin.js";
import { softDeletePlugin } from "../../../../common/plugins/softDelete.plugin.js";
import { MINUTES_IN_DAY } from "./clinicDoctorSchedule.model.js";

const { Schema } = mongoose;

// ─── Sub-schema: a working interval (only used when type === "custom") ─
//
// Identical shape to ClinicDoctorSchedule's intervalSchema. Kept as its own
// definition rather than imported, because Mongoose sub-schemas are bound
// to their parent and sharing instances across models is fragile.
// startMinute / endMinute = minutes from local midnight.
// Invariant (enforced by validator, not just schema): start < end.

const exceptionIntervalSchema = new Schema(
  {
    startMinute: {
      type: Number,
      required: true,
      min: 0,
      max: MINUTES_IN_DAY - 1,
    },
    endMinute: {
      type: Number,
      required: true,
      min: 1,
      max: MINUTES_IN_DAY,
    },
  },
  { _id: false },
);

// ─── Main schema ──────────────────────────────────────────────────────

const clinicScheduleExceptionSchema = new Schema(
  {
    // tenantScoped plugin requires this — every query is filtered by it
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // The doctor this exception applies to. Same actor model as
    // ClinicDoctorSchedule.doctorId — a DocPats User who is an active
    // doctor-capable member of the clinic. The service validates
    // membership before writing.
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // The specific calendar date this exception covers, stored as a UTC
    // Date pinned to midnight of the clinic-local day (see header note).
    // One exception per (clinic, doctor, date) — enforced in the service
    // via upsert, not via a unique index (soft-delete field-name caveat,
    // same reasoning as ClinicDoctorSchedule).
    date: {
      type: Date,
      required: true,
      index: true,
    },

    // What kind of override this is.
    //   "day_off" → doctor not working at all that date; `intervals` empty.
    //   "custom"  → doctor working with `intervals` instead of the weekly
    //               pattern for that weekday.
    type: {
      type: String,
      enum: ["day_off", "custom"],
      required: true,
    },

    // Working intervals — ONLY meaningful when type === "custom".
    // For type "day_off" this stays an empty array. The validator enforces:
    //   - type "custom"  ⇒ intervals non-empty, each valid, no overlaps
    //   - type "day_off" ⇒ intervals empty
    intervals: {
      type: [exceptionIntervalSchema],
      default: [],
    },

    // Optional human-readable reason ("Annual leave", "Public holiday",
    // "Conference"). NOT PHI — it's about the doctor's availability, not a
    // patient. Kept short; purely informational, shown in the schedule UI.
    note: {
      type: String,
      default: null,
      maxlength: 200,
      trim: true,
    },

    // ─── Audit fields ───
    // Actor can live in either User or ClinicEmployee — we don't enforce ref.
    createdBy: { type: Schema.Types.ObjectId, required: true },
    createdByType: {
      type: String,
      enum: ["user", "employee"],
      required: true,
    },
    lastUpdatedBy: { type: Schema.Types.ObjectId, default: null },
    lastUpdatedByType: {
      type: String,
      enum: ["user", "employee", null],
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "clinic_schedule_exceptions",
  },
);

// ─── Indexes ──────────────────────────────────────────────────────────

// Primary access pattern for slot generation: "is there an exception for
// THIS doctor on THIS exact date?" — exact-match on the triple.
clinicScheduleExceptionSchema.index({ clinicId: 1, doctorId: 1, date: 1 });

// Range scan: "all exceptions for this doctor between date A and date B"
// — used when the schedule UI renders a month, or the slot generator
// pre-loads a date window. clinicId first (tenant), then doctor, then date.
clinicScheduleExceptionSchema.index({ clinicId: 1, doctorId: 1, date: -1 });

// Clinic-wide range scan: "all exceptions in the clinic for a date window"
// — admin calendar overview across all doctors.
clinicScheduleExceptionSchema.index({ clinicId: 1, date: 1 });

// ─── Plugins ──────────────────────────────────────────────────────────

clinicScheduleExceptionSchema.plugin(tenantScopedPlugin);
clinicScheduleExceptionSchema.plugin(softDeletePlugin);

// ─── Serialization ────────────────────────────────────────────────────

clinicScheduleExceptionSchema.set("toJSON", { virtuals: true });
clinicScheduleExceptionSchema.set("toObject", { virtuals: true });

// ─── Model export (safe for hot reload / multiple imports) ────────────

const ClinicScheduleException =
  mongoose.models.ClinicScheduleException ||
  mongoose.model("ClinicScheduleException", clinicScheduleExceptionSchema);

export default ClinicScheduleException;
