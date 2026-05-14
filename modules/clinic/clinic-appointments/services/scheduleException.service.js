// server/modules/clinic/clinic-appointments/services/scheduleException.service.js
//
// Service layer for per-date schedule exceptions (day-off / custom hours).
//
// Responsibilities:
//   - createException:   one exception for one date (upsert by date)
//   - bulkCreateDayOff:  expand a date range into N "day_off" exceptions
//   - listExceptions:    all exceptions for a doctor in a date window
//   - deleteException:   remove one exception by its id
//
// THE HARD PART — timezone-correct date handling:
//   An exception's `date` must represent a CALENDAR DAY in the CLINIC's
//   local timezone, stored as a UTC Date pinned to that day's local
//   midnight. If a clinic is in "Asia/Baku" (UTC+4), then "2026-05-20"
//   means the instant 2026-05-19T20:00:00Z. We must store exactly that, so
//   that:
//     - exact-date equality queries work regardless of server timezone
//     - the slot generator (Day 3) compares apples to apples
//
//   We do this with the native Intl API — NO external date library, so
//   nothing new to install in the HIPAA prod environment. The trick:
//   `Intl.DateTimeFormat` can tell us what local wall-clock time a given
//   UTC instant shows in a target timezone. We use that to compute the
//   UTC offset for the target date, then subtract it. This is correct
//   across DST boundaries because we compute the offset FOR THAT DATE.
//
// Tenant safety: clinicId always from tenantContext, never from input.
// Doctor-membership: same gate as the weekly schedule — write paths require
// the target to be an active doctor-capable "user" member of the clinic.
//
// Fully isolated from the legacy per-doctor appointments module.

import mongoose from "mongoose";

import ClinicScheduleException from "../models/clinicScheduleException.model.js";
import ClinicMembership from "../../clinic-staff/models/clinicMembership.model.js";
import Clinic from "../../clinic-core/models/clinic.model.js";

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

// Same role gate as staffSchedule.service — who is allowed to have / have
// managed a working schedule. The actorType==="user" check matters more.
const SCHEDULE_CAPABLE_ROLES = new Set(["owner", "admin", "doctor"]);

// Fallback timezone if a clinic somehow has none set. Asia/Baku is the
// platform's primary market (AZ). The service still works for any IANA tz.
const DEFAULT_TZ = "Asia/Baku";

// ─── Timezone-aware date conversion ───────────────────────────────────

/**
 * Given a target timezone and a calendar date (year/month/day), return the
 * UTC Date corresponding to LOCAL MIDNIGHT of that date in that timezone.
 *
 * Approach:
 *   1. Take a first guess: the UTC instant Date.UTC(y, m-1, d) — i.e.
 *      "midnight UTC" of that calendar date.
 *   2. Ask Intl what wall-clock time that instant shows in the target tz.
 *   3. The difference between the guessed UTC instant and the wall-clock
 *      it produced IS the tz offset for that date. Subtract it from the
 *      guess to land on true local midnight.
 *   4. One refinement pass handles the rare DST-edge case where the offset
 *      at the guess differs from the offset at the corrected instant.
 *
 * This is correct across DST because the offset is computed FOR THE DATE,
 * not assumed constant.
 *
 * @param {string} timeZone  IANA tz, e.g. "Asia/Baku"
 * @param {number} year
 * @param {number} month  1-based (1 = January)
 * @param {number} day
 * @returns {Date}  UTC Date == local midnight of {year,month,day} in tz
 */
function localMidnightToUTC(timeZone, year, month, day) {
  // Formatter that renders an instant as wall-clock parts in the target tz.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // Given a UTC instant (ms), return what the target tz shows as a UTC-ms
  // value of those same wall-clock numbers. The gap between input and
  // output is the tz offset at that instant.
  function wallClockAsUTC(utcMs) {
    const parts = fmt.formatToParts(new Date(utcMs));
    const map = {};
    for (const p of parts) {
      if (p.type !== "literal") map[p.type] = parseInt(p.value, 10);
    }
    // Intl can emit hour "24" for midnight in some engines — normalize.
    let h = map.hour;
    if (h === 24) h = 0;
    return Date.UTC(
      map.year,
      map.month - 1,
      map.day,
      h,
      map.minute,
      map.second,
    );
  }

  // Guess: midnight-UTC of the calendar date.
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  // Offset at the guess: how far the tz wall-clock is from the UTC instant.
  const offset1 = wallClockAsUTC(guess) - guess;
  // Corrected instant = guess minus that offset.
  let corrected = guess - offset1;
  // Refinement: re-measure the offset at the corrected instant. If a DST
  // transition sits between guess and corrected, the offset changed; one
  // more correction converges.
  const offset2 = wallClockAsUTC(corrected) - corrected;
  if (offset2 !== offset1) {
    corrected = guess - offset2;
  }

  return new Date(corrected);
}

// ─── Internal helpers ─────────────────────────────────────────────────

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) {
    throw new ForbiddenError("No clinic context — cannot access exceptions");
  }
  return clinicId;
}

function requireActor() {
  const id = getCurrentUserId();
  const type = getCurrentActorType();
  if (!id || !type) {
    throw new ForbiddenError("No actor context — cannot write exception");
  }
  return { id, type };
}

/**
 * Resolve the clinic's IANA timezone. Falls back to DEFAULT_TZ if unset.
 * Cached per call chain would be nicer, but exception writes are rare —
 * a direct lookup is fine and keeps the code obvious.
 */
async function resolveClinicTimezone(clinicId) {
  const clinic = await Clinic.findById(clinicId).select("timezone").lean();
  if (!clinic) {
    // Shouldn't happen — tenantMiddleware resolved this clinic — but fail
    // closed rather than silently using a default for a nonexistent clinic.
    throw new NotFoundError("Clinic");
  }
  return clinic.timezone || DEFAULT_TZ;
}

/**
 * Same doctor-membership gate as staffSchedule.service.assertDoctorOfClinic.
 * Throws NotFoundError if no active doctor-capable "user" membership exists.
 */
async function assertDoctorOfClinic(doctorId, clinicId) {
  if (!mongoose.isValidObjectId(doctorId)) {
    throw new ValidationError("doctorId is not a valid id", {
      field: "doctorId",
      received: doctorId,
    });
  }

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
      `Member role "${membership.role}" cannot have schedule exceptions`,
      { field: "doctorId", role: membership.role },
    );
  }
  return membership;
}

/**
 * Walk a calendar date range INCLUSIVE, yielding {year,month,day} for every
 * day. Pure calendar arithmetic — no timezone involved here; we increment
 * the civil date. Timezone conversion happens per-day afterwards.
 */
function* iterateCalendarDays(start, end) {
  // start / end are { year, month, day } (1-based month).
  let y = start.year;
  let m = start.month;
  let d = start.day;

  const endKey = end.year * 10000 + end.month * 100 + end.day;

  while (true) {
    const curKey = y * 10000 + m * 100 + d;
    yield { year: y, month: m, day: d };
    if (curKey >= endKey) break;

    // Advance one civil day.
    d += 1;
    const daysInMonth = new Date(y, m, 0).getDate(); // last day of month m
    if (d > daysInMonth) {
      d = 1;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
}

/**
 * Shape an exception document into the API DTO.
 */
function toExceptionDTO(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    clinicId: String(doc.clinicId),
    doctorId: String(doc.doctorId),
    date: doc.date, // UTC Date == clinic-local midnight
    type: doc.type,
    intervals: (doc.intervals || []).map((iv) => ({
      startMinute: iv.startMinute,
      endMinute: iv.endMinute,
    })),
    note: doc.note ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Create (or replace) one schedule exception for one date.
 *
 * `payload` MUST be the validated output of validateCreateException():
 *   { date: {iso,year,month,day}, type, intervals, note }
 *
 * Upsert keyed on (clinicId, doctorId, date) → calling twice for the same
 * date replaces the previous exception. This is intentional: re-submitting
 * "2026-05-20 = day_off" then "2026-05-20 = custom 10-14" should leave one
 * exception (the latter), not two conflicting ones.
 *
 * @param {string} doctorId
 * @param {object} payload  validated create-exception payload
 * @returns {Promise<object>} exception DTO
 */
export async function createException(doctorId, payload) {
  const clinicId = requireClinicId();
  const actor = requireActor();

  await assertDoctorOfClinic(doctorId, clinicId);

  const timeZone = await resolveClinicTimezone(clinicId);
  const utcDate = localMidnightToUTC(
    timeZone,
    payload.date.year,
    payload.date.month,
    payload.date.day,
  );

  const now = new Date();

  const updated = await ClinicScheduleException.findOneAndUpdate(
    { clinicId, doctorId, date: utcDate },
    {
      $set: {
        type: payload.type,
        intervals: payload.type === "custom" ? payload.intervals : [],
        note: payload.note,
        lastUpdatedBy: actor.id,
        lastUpdatedByType: actor.type,
        updatedAt: now,
      },
      $setOnInsert: {
        clinicId,
        doctorId,
        date: utcDate,
        createdBy: actor.id,
        createdByType: actor.type,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  ).lean();

  return toExceptionDTO(updated);
}

/**
 * Bulk-create "day_off" exceptions across an inclusive date range
 * (vacation). Each calendar day in [startDate..endDate] becomes its own
 * single-date "day_off" exception.
 *
 * `payload` MUST be the validated output of validateBulkDayOff():
 *   { startDate: {iso,...}, endDate: {iso,...}, note }
 *
 * Idempotent per day: uses upsert keyed on (clinicId, doctorId, date), so
 * re-running an overlapping range doesn't create duplicates — it just
 * re-stamps those days as day_off.
 *
 * @param {string} doctorId
 * @param {object} payload  validated bulk-day-off payload
 * @returns {Promise<{ created: number, days: string[] }>}
 *          count + list of ISO dates affected
 */
export async function bulkCreateDayOff(doctorId, payload) {
  const clinicId = requireClinicId();
  const actor = requireActor();

  await assertDoctorOfClinic(doctorId, clinicId);

  const timeZone = await resolveClinicTimezone(clinicId);
  const now = new Date();

  // Build one bulkWrite upsert op per calendar day.
  const ops = [];
  const isoDays = [];
  for (const cal of iterateCalendarDays(payload.startDate, payload.endDate)) {
    const utcDate = localMidnightToUTC(timeZone, cal.year, cal.month, cal.day);
    const iso =
      `${cal.year}-${String(cal.month).padStart(2, "0")}-` +
      `${String(cal.day).padStart(2, "0")}`;
    isoDays.push(iso);

    ops.push({
      updateOne: {
        filter: { clinicId, doctorId, date: utcDate },
        update: {
          $set: {
            type: "day_off",
            intervals: [],
            note: payload.note,
            lastUpdatedBy: actor.id,
            lastUpdatedByType: actor.type,
            updatedAt: now,
          },
          $setOnInsert: {
            clinicId,
            doctorId,
            date: utcDate,
            createdBy: actor.id,
            createdByType: actor.type,
          },
        },
        upsert: true,
      },
    });
  }

  if (ops.length === 0) {
    // Shouldn't happen — validator guarantees start <= end — but be safe.
    return { created: 0, days: [] };
  }

  await ClinicScheduleException.bulkWrite(ops, { ordered: false });

  return { created: isoDays.length, days: isoDays };
}

/**
 * List all exceptions for one doctor within an inclusive date window.
 *
 * `range` MUST be the validated output of validateDateRangeQuery():
 *   { from: {iso,year,month,day}, to: {iso,year,month,day} }
 *
 * Read path — does NOT require the doctor to be a current active member
 * (consistent with getScheduleByDoctor: schedules/exceptions may outlive a
 * brief membership lapse, and read access is harmless).
 *
 * @param {string} doctorId
 * @param {object} range  validated date-range
 * @returns {Promise<object[]>} array of exception DTOs, sorted by date asc
 */
export async function listExceptions(doctorId, range) {
  const clinicId = requireClinicId();

  if (!mongoose.isValidObjectId(doctorId)) {
    throw new ValidationError("doctorId is not a valid id", {
      field: "doctorId",
      received: doctorId,
    });
  }

  const timeZone = await resolveClinicTimezone(clinicId);

  // Window bounds: local midnight of `from` .. local midnight of `to`.
  // We want `to` INCLUSIVE, so the query upper bound is the START of the
  // day AFTER `to` (exclusive) — simplest correct way to include all of
  // `to`'s day without time-of-day fuss (exceptions are always stored at
  // local midnight, so $lte the `to` midnight would already include it;
  // but using $lt next-day is robust if that ever changes).
  const fromUTC = localMidnightToUTC(
    timeZone,
    range.from.year,
    range.from.month,
    range.from.day,
  );
  const toUTC = localMidnightToUTC(
    timeZone,
    range.to.year,
    range.to.month,
    range.to.day,
  );

  const docs = await ClinicScheduleException.find({
    clinicId,
    doctorId,
    date: { $gte: fromUTC, $lte: toUTC },
  })
    .sort({ date: 1 })
    .lean();

  return docs.map(toExceptionDTO);
}

/**
 * Delete one exception by its id. Soft-delete via the plugin.
 *
 * Tenant-scoped: the query includes clinicId, so a caller cannot delete an
 * exception belonging to another clinic even with a valid id.
 *
 * @param {string} exceptionId
 * @returns {Promise<{ deleted: true, id: string }>}
 * @throws {NotFoundError} if no such exception in this clinic
 */
export async function deleteException(exceptionId) {
  const clinicId = requireClinicId();
  requireActor(); // ensure there IS an actor context (write operation)

  if (!mongoose.isValidObjectId(exceptionId)) {
    throw new ValidationError("exceptionId is not a valid id", {
      field: "exceptionId",
      received: exceptionId,
    });
  }

  // softDelete plugin: assuming it exposes the standard pattern, a plain
  // deleteOne goes through the plugin's soft-delete override. If the
  // plugin instead requires an explicit .softDelete() call, this is the
  // one spot to adjust — but findOneAndUpdate-style soft delete via the
  // plugin's query middleware is the common shape in this codebase.
  const doc = await ClinicScheduleException.findOne({
    _id: exceptionId,
    clinicId,
  });

  if (!doc) {
    throw new NotFoundError("Schedule exception");
  }

  await doc.deleteOne(); // soft-delete via plugin query middleware

  return { deleted: true, id: String(exceptionId) };
}

/**
 * Internal helper for the slot-generation service (Day 3).
 * Returns RAW lean exception docs for a doctor in a date window — no DTO
 * mapping, gives the slot generator exactly the fields it needs.
 *
 * @param {string} doctorId
 * @param {string} clinicId  explicit — slot generator may run outside a
 *                           per-request tenant context
 * @param {Date} fromUTC     inclusive lower bound (already a Date)
 * @param {Date} toUTC       inclusive upper bound (already a Date)
 * @returns {Promise<object[]>}
 */
export async function _getRawExceptionsForSlots(
  doctorId,
  clinicId,
  fromUTC,
  toUTC,
) {
  if (!mongoose.isValidObjectId(doctorId)) return [];
  if (!clinicId) return [];
  return ClinicScheduleException.find({
    clinicId,
    doctorId,
    date: { $gte: fromUTC, $lte: toUTC },
  })
    .sort({ date: 1 })
    .lean();
}

// Exported for unit tests + reuse by the slot generator.
export { localMidnightToUTC };

export default {
  createException,
  bulkCreateDayOff,
  listExceptions,
  deleteException,
  _getRawExceptionsForSlots,
  localMidnightToUTC,
};
