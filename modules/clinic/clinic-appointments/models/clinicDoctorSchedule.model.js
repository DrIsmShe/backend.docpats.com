// server/modules/clinic/clinic-appointments/models/clinicDoctorSchedule.model.js
//
// Weekly recurring working hours for a doctor WITHIN a clinic.
//
// Scope note:
//   This is the CLINIC appointments module. It is fully isolated from the
//   legacy per-doctor `modules/appointments/` module — separate collections,
//   separate routes (/api/v1/clinic/appointments/*), separate models.
//   Nothing here touches the old `doctorschedules` / `appointments` data.
//
// Design:
//   - ONE document per (clinicId, doctorId). The whole weekly pattern lives
//     in `weeklyHours` (array, one entry per weekday that has working time).
//   - A day can have MULTIPLE intervals (e.g. 09:00–13:00 + 14:00–18:00 with
//     a lunch break) — `intervals` is an array.
//   - Times are stored as MINUTES FROM MIDNIGHT (0–1439) in the CLINIC's
//     local timezone. Integer math, no string parsing. The clinic timezone
//     lives on the Clinic model (IANA string, e.g. "Asia/Baku"); slot
//     computation converts local → UTC.
//   - This is NOT PHI (a doctor's working hours are not protected health
//     information), so no field-level encryption — unlike ClinicPatient.
//
// Multi-tenancy:
//   tenantScoped plugin enforces clinicId on every query. softDelete plugin
//   adds soft-delete semantics for consistency with the rest of the clinic
//   module. Uniqueness of (clinicId, doctorId) is enforced in the service
//   layer via findOneAndUpdate upsert — NOT via a unique index — so we don't
//   depend on the soft-delete field name for a partial filter expression.

import mongoose from "mongoose";
import { tenantScopedPlugin } from "../../../../common/plugins/tenantScoped.plugin.js";
import { softDeletePlugin } from "../../../../common/plugins/softDelete.plugin.js";

const { Schema } = mongoose;

const MINUTES_IN_DAY = 24 * 60; // 1440

// ─── Sub-schema: a single working interval within one day ─────────────
//
// startMinute / endMinute are minutes from local midnight.
// Invariant: 0 <= startMinute < endMinute <= 1440.
// (endMinute === 1440 means "until midnight".)

const intervalSchema = new Schema(
  {
    startMinute: {
      type: Number,
      required: true,
      min: 0,
      max: MINUTES_IN_DAY - 1, // a start at 1440 makes no sense
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

// ─── Sub-schema: one weekday's working hours ──────────────────────────
//
// weekday follows JS Date.getDay() convention:
//   0 = Sunday, 1 = Monday, ... 6 = Saturday.
// `intervals` empty => the doctor is treated as not working that weekday.

const weekdaySchema = new Schema(
  {
    weekday: {
      type: Number,
      required: true,
      min: 0,
      max: 6,
    },
    intervals: {
      type: [intervalSchema],
      default: [],
    },
  },
  { _id: false },
);

// ─── Main schema ──────────────────────────────────────────────────────

const clinicDoctorScheduleSchema = new Schema(
  {
    // tenantScoped plugin requires this — every query is filtered by it
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // The doctor this schedule belongs to. A doctor inside a clinic is a
    // DocPats User (ClinicMembership.actorType === "user", role "doctor").
    // The service layer validates that this user is actually an active
    // member of `clinicId` with a doctor-capable role before upserting.
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Weekly recurring pattern. At most 7 entries (one per weekday).
    // Days not present in the array are non-working by default.
    weeklyHours: {
      type: [weekdaySchema],
      default: [],
    },

    // Length of one bookable slot, in minutes. Slot generation walks each
    // working interval in steps of this size. Common values: 15 / 20 / 30.
    slotDurationMinutes: {
      type: Number,
      required: true,
      default: 30,
      min: 5,
      max: 240,
    },

    // Optional gap enforced AFTER each appointment (cleanup, notes, etc.).
    // 0 = back-to-back booking allowed. Used by the slot generator and the
    // conflict checker. Kept simple for MVP; can be elaborated later.
    bufferMinutes: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: 120,
    },

    // Soft on/off switch for the whole schedule without deleting it.
    // When false, the slot generator yields nothing for this doctor.
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },

    // ─── Audit fields ───
    // Actor can live in either User or ClinicEmployee — we don't enforce ref.
    // (Receptionists are ClinicEmployee; owner/admin are User.)
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
    collection: "clinic_doctor_schedules",
  },
);

// ─── Indexes ──────────────────────────────────────────────────────────

// Primary access pattern: "give me this doctor's schedule in this clinic".
// NOT declared unique here on purpose — soft-deleted rows would collide,
// and we don't want to depend on the soft-delete field name for a partial
// filter. Uniqueness is enforced in staffSchedule.service via upsert.
clinicDoctorScheduleSchema.index({ clinicId: 1, doctorId: 1 });

// Secondary: "list all schedules in this clinic" (admin overview screen).
clinicDoctorScheduleSchema.index({ clinicId: 1, isActive: 1 });

// ─── Plugins ──────────────────────────────────────────────────────────

clinicDoctorScheduleSchema.plugin(tenantScopedPlugin);
clinicDoctorScheduleSchema.plugin(softDeletePlugin);

// ─── Serialization ────────────────────────────────────────────────────
//
// No encrypted fields to strip (not PHI), but we still enable virtuals so
// any future computed fields surface in JSON consistently with the rest of
// the clinic module.

clinicDoctorScheduleSchema.set("toJSON", { virtuals: true });
clinicDoctorScheduleSchema.set("toObject", { virtuals: true });

// ─── Model export (safe for hot reload / multiple imports) ────────────

const ClinicDoctorSchedule =
  mongoose.models.ClinicDoctorSchedule ||
  mongoose.model("ClinicDoctorSchedule", clinicDoctorScheduleSchema);

export default ClinicDoctorSchedule;

// ─── Exported constants — reused by validators & slot generator ───────

export { MINUTES_IN_DAY };
