// server/modules/clinic/clinic-appointments/services/staffSchedule.service.js
//
// Service layer for a doctor's weekly working schedule inside a clinic.
//
// Responsibilities:
//   - upsertSchedule: create-or-replace the weekly pattern for one doctor.
//     Enforces "one schedule document per (clinicId, doctorId)" via
//     findOneAndUpdate({ upsert: true }) — NOT a unique index — so we don't
//     depend on the soft-delete field name for a partial filter.
//   - getScheduleByDoctor: fetch one doctor's schedule (or null).
//   - listSchedules: fetch all schedules in the current clinic.
//
// Tenant safety:
//   The clinicId is ALWAYS taken from tenantContext (getCurrentClinicId()),
//   never from the request body or params. The tenantScoped plugin also
//   re-applies clinicId to every query as defence-in-depth, but we pass it
//   explicitly too so the intent is visible at the call site.
//
// Doctor-membership validation:
//   Before writing a schedule we verify that `doctorId` is an ACTIVE member
//   of the current clinic with a doctor-capable role, and that they're a
//   "user" actor (a DocPats User — not a ClinicEmployee like a nurse or
//   receptionist). Receptionists don't have schedules; only doctors do.
//
// This module is fully isolated from the legacy per-doctor appointments
// module — different collection (clinic_doctor_schedules), different model.

import mongoose from "mongoose";

import ClinicDoctorSchedule from "../models/clinicDoctorSchedule.model.js";
import ClinicMembership from "../../clinic-staff/models/clinicMembership.model.js";

import {
  getCurrentClinicId,
  getCurrentUserId,
  getCurrentActorType,
} from "../../../../common/context/tenantContext.js";

import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from "../../../../common/utils/errors.js";

// ─── Constants ────────────────────────────────────────────────────────

// Roles that are allowed to HAVE a schedule (i.e. actually see patients).
// owner/admin can be doctors too in a small clinic, so they're included —
// the gate that really matters is actorType === "user" (a real DocPats
// doctor account), checked alongside this.
const SCHEDULE_CAPABLE_ROLES = new Set(["owner", "admin", "doctor"]);

// ─── Internal helpers ─────────────────────────────────────────────────

/**
 * Resolve and validate the current tenant clinicId from context.
 * Throws ForbiddenError if there's no clinic in context (request reached
 * the service without a resolved tenant — should never happen behind
 * tenantMiddleware, but we fail closed).
 */
function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) {
    throw new ForbiddenError("No clinic context — cannot access schedules");
  }
  return clinicId;
}

/**
 * Resolve the current actor (who is performing the write) for audit fields.
 * Returns { id, type } where type is "user" | "employee".
 */
function requireActor() {
  const id = getCurrentUserId();
  const type = getCurrentActorType();
  if (!id || !type) {
    throw new ForbiddenError("No actor context — cannot write schedule");
  }
  return { id, type };
}

/**
 * Verify that `doctorId` is a doctor-capable, ACTIVE, "user"-type member
 * of `clinicId`. Throws NotFoundError if no such membership exists, or
 * ValidationError if the member exists but isn't schedule-capable
 * (e.g. it's a receptionist/nurse employee).
 *
 * @returns {Promise<object>} the membership lean document
 */
async function assertDoctorOfClinic(doctorId, clinicId) {
  if (!mongoose.isValidObjectId(doctorId)) {
    throw new ValidationError("doctorId is not a valid id", {
      field: "doctorId",
      received: doctorId,
    });
  }

  // A clinic doctor lives in the User collection → actorType "user".
  // Membership.userId holds the User._id in that case.
  const membership = await ClinicMembership.findOne({
    userId: doctorId,
    clinicId,
    actorType: "user",
    isActive: true,
    leftAt: null,
  }).lean();

  if (!membership) {
    throw new NotFoundError("Active doctor membership for this clinic");
  }

  if (!SCHEDULE_CAPABLE_ROLES.has(membership.role)) {
    throw new ValidationError(
      `Member role "${membership.role}" cannot have a working schedule`,
      { field: "doctorId", role: membership.role },
    );
  }

  return membership;
}

/**
 * Strip a schedule document down to the shape the API returns. Keeps the
 * response stable and intentional rather than leaking whatever Mongoose
 * happens to include.
 */
function toScheduleDTO(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    clinicId: String(doc.clinicId),
    doctorId: String(doc.doctorId),
    weeklyHours: (doc.weeklyHours || []).map((d) => ({
      weekday: d.weekday,
      intervals: (d.intervals || []).map((iv) => ({
        startMinute: iv.startMinute,
        endMinute: iv.endMinute,
      })),
    })),
    slotDurationMinutes: doc.slotDurationMinutes,
    bufferMinutes: doc.bufferMinutes,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Create-or-replace the weekly schedule for one doctor in the current clinic.
 *
 * `payload` MUST already be the validated/normalized output of
 * validateUpsertSchedule() — the service does NOT re-validate structure,
 * only business rules (tenant, doctor membership).
 *
 * Idempotent: calling twice with the same payload yields the same document.
 *
 * @param {string} doctorId  User._id of the doctor
 * @param {object} payload   { weeklyHours, slotDurationMinutes, bufferMinutes, isActive }
 * @returns {Promise<object>} schedule DTO
 */
export async function upsertSchedule(doctorId, payload) {
  const clinicId = requireClinicId();
  const actor = requireActor();

  // Business-rule gate: the target must be a real doctor of THIS clinic.
  await assertDoctorOfClinic(doctorId, clinicId);

  const now = new Date();

  // findOneAndUpdate with upsert gives us "one doc per (clinic,doctor)"
  // without a unique index. $setOnInsert handles the create-only fields
  // (createdBy/createdByType), $set handles everything that can change.
  const updated = await ClinicDoctorSchedule.findOneAndUpdate(
    { clinicId, doctorId },
    {
      $set: {
        weeklyHours: payload.weeklyHours,
        slotDurationMinutes: payload.slotDurationMinutes,
        bufferMinutes: payload.bufferMinutes,
        isActive: payload.isActive,
        lastUpdatedBy: actor.id,
        lastUpdatedByType: actor.type,
        updatedAt: now,
      },
      $setOnInsert: {
        clinicId,
        doctorId,
        createdBy: actor.id,
        createdByType: actor.type,
      },
    },
    {
      new: true,
      upsert: true,
      // runValidators ensures the sub-schema bounds (minute ranges, slot
      // duration limits) are enforced at the DB layer even though the
      // validator already checked them — defence in depth.
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  ).lean();

  return toScheduleDTO(updated);
}

/**
 * Get one doctor's schedule in the current clinic.
 * Returns null if the doctor has no schedule yet (NOT an error — a doctor
 * simply may not have configured one).
 *
 * Does NOT require the target to be a current active member: a schedule may
 * legitimately outlive a brief membership lapse, and read access is harmless.
 * Write paths (upsertSchedule) DO enforce active membership.
 *
 * @param {string} doctorId
 * @returns {Promise<object|null>} schedule DTO or null
 */
export async function getScheduleByDoctor(doctorId) {
  const clinicId = requireClinicId();

  if (!mongoose.isValidObjectId(doctorId)) {
    throw new ValidationError("doctorId is not a valid id", {
      field: "doctorId",
      received: doctorId,
    });
  }

  const doc = await ClinicDoctorSchedule.findOne({
    clinicId,
    doctorId,
  }).lean();

  return toScheduleDTO(doc);
}

/**
 * List every schedule in the current clinic. Used by the admin overview
 * screen. Returns an array of DTOs (possibly empty).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.activeOnly=false]  if true, only isActive schedules
 * @returns {Promise<object[]>}
 */
export async function listSchedules(opts = {}) {
  const clinicId = requireClinicId();
  const { activeOnly = false } = opts;

  const query = { clinicId };
  if (activeOnly) query.isActive = true;

  const docs = await ClinicDoctorSchedule.find(query)
    .sort({ updatedAt: -1 })
    .lean();

  return docs.map(toScheduleDTO);
}

/**
 * Internal helper exported for the slot-generation service (Day 3).
 * Returns the RAW lean schedule doc (not a DTO) for one doctor, or null.
 * Kept separate from getScheduleByDoctor so the slot generator gets the
 * shape it needs without an extra DTO round-trip, while the public API
 * stays DTO-only.
 *
 * @param {string} doctorId
 * @param {string} clinicId  explicit — slot generator may run outside a
 *                           per-request tenant context (e.g. batch jobs)
 * @returns {Promise<object|null>}
 */
export async function _getRawScheduleForSlots(doctorId, clinicId) {
  if (!mongoose.isValidObjectId(doctorId)) return null;
  if (!clinicId) return null;
  return ClinicDoctorSchedule.findOne({ clinicId, doctorId }).lean();
}

export default {
  upsertSchedule,
  getScheduleByDoctor,
  listSchedules,
  _getRawScheduleForSlots,
};
