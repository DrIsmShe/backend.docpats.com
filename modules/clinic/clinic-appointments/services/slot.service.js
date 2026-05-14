// server/modules/clinic/clinic-appointments/services/slot.service.js
//
// Slot-computation service (Sprint 1, day 3).
//
// Turns a doctor's weekly working-hours pattern + per-date exceptions into
// a concrete list of bookable time slots for a date window.
//
// This is PURE LOGIC — no new model. It composes the two raw-data helpers
// written on days 1 and 2:
//   _getRawScheduleForSlots(doctorId, clinicId)        → weekly pattern
//   _getRawExceptionsForSlots(doctorId, clinicId, …)   → per-date overrides
//
// Resolution algorithm, per calendar date in [from..to]:
//   1. No active weekly schedule at all  → no slots for any date.
//   2. Exception on that date, type "day_off"  → no slots that date.
//   3. Exception on that date, type "custom"   → use exception.intervals
//      (they FULLY REPLACE the weekday pattern).
//   4. No exception → use weeklyHours for that date's weekday
//      (weekday = Date.getDay() of the date IN THE CLINIC's timezone).
//   5. Each resolved interval is sliced into slots:
//        step      = slotDurationMinutes + bufferMinutes
//        a slot fits if  slotStart + slotDurationMinutes <= intervalEnd
//
// IMPORTANT — day 3 does NOT subtract booked appointments. The
// ClinicAppointment model doesn't exist yet (day 4-5). Every slot returned
// here is "the doctor works then" — not "the doctor is free then". Day 4
// adds the booked-slot filtering on top of this service.
//
// Past slots are NOT trimmed — the service answers "when does the doctor
// work", a pure availability question. Filtering to future-only is the
// booking UI's job.
//
// Timezone: a slot's startMinute is minutes-from-local-midnight in the
// clinic's timezone. startUTC is the absolute UTC instant of that slot's
// start, computed via localMidnightToUTC (day-2 helper, DST-correct).

import mongoose from "mongoose";

import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from "../../../../common/utils/errors.js";
import Clinic from "../../clinic-core/models/clinic.model.js";

import { _getRawScheduleForSlots } from "./staffSchedule.service.js";
import {
  _getRawExceptionsForSlots,
  localMidnightToUTC,
} from "./scheduleException.service.js";

// ─── Constants ────────────────────────────────────────────────

// Max width of a slot query window. 62 days ≈ 2 months. A wider request
// would return thousands of slots in one response — refuse it.
const MAX_WINDOW_DAYS = 62;

// Fallback timezone — same as scheduleException.service. Asia/Baku is the
// platform's primary market; the logic works for any IANA tz.
const DEFAULT_TZ = "Asia/Baku";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Internal helpers ─────────────────────────────────────────

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) {
    throw new ForbiddenError("No clinic context — cannot compute slots");
  }
  return clinicId;
}

/**
 * Validate a "YYYY-MM-DD" string → { iso, year, month, day }.
 * Leap-year-aware calendar check. (Mirrors the date validator from
 * scheduleException.validator, kept local to avoid a cross-import just
 * for this.)
 */
function parseDateString(raw, fieldPath) {
  if (typeof raw !== "string") {
    throw new ValidationError(`${fieldPath} must be a "YYYY-MM-DD" string`, {
      field: fieldPath,
      received: raw,
    });
  }
  const trimmed = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) {
    throw new ValidationError(`${fieldPath} must match format YYYY-MM-DD`, {
      field: fieldPath,
      received: raw,
    });
  }
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12) {
    throw new ValidationError(`${fieldPath}: month out of range`, {
      field: fieldPath,
      received: raw,
    });
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    throw new ValidationError(
      `${fieldPath}: day ${day} does not exist in ${m[1]}-${m[2]}`,
      { field: fieldPath, received: raw },
    );
  }
  if (year < 2000 || year > 2100) {
    throw new ValidationError(`${fieldPath}: year out of supported range`, {
      field: fieldPath,
      received: raw,
    });
  }
  return { iso: trimmed, year, month, day };
}

/**
 * Resolve the clinic's IANA timezone (falls back to DEFAULT_TZ).
 */
async function resolveClinicTimezone(clinicId) {
  const clinic = await Clinic.findById(clinicId).select("timezone").lean();
  if (!clinic) {
    throw new NotFoundError("Clinic");
  }
  return clinic.timezone || DEFAULT_TZ;
}

/**
 * Walk a calendar date range INCLUSIVE, yielding { year, month, day } for
 * every civil day. Pure calendar arithmetic — no timezone here.
 * (Same shape as the iterator in scheduleException.service; kept local.)
 */
function* iterateCalendarDays(start, end) {
  let y = start.year;
  let m = start.month;
  let d = start.day;
  const endKey = end.year * 10000 + end.month * 100 + end.day;
  while (true) {
    const curKey = y * 10000 + m * 100 + d;
    yield { year: y, month: m, day: d };
    if (curKey >= endKey) break;
    d += 1;
    const daysInMonth = new Date(y, m, 0).getDate();
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
 * What weekday is {year,month,day} in the given timezone?
 * Returns 0-6 (0 = Sunday), matching JS Date.getDay() and the weekday
 * values stored in ClinicDoctorSchedule.weeklyHours.
 *
 * We compute it from the UTC instant of that date's local midnight: that
 * instant, read back in the clinic tz, is on the intended calendar day, so
 * its weekday in the clinic tz is what we want. Using Intl with weekday
 * formatting in the target tz is the robust way (no off-by-one from the
 * server's own tz).
 */
function weekdayInTimezone(timeZone, year, month, day) {
  const utc = localMidnightToUTC(timeZone, year, month, day);
  // Add a few hours so we're safely inside the local day even right at the
  // midnight boundary, then read the weekday in the clinic tz.
  const probe = new Date(utc.getTime() + 6 * 60 * 60 * 1000);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(probe);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd];
}

/**
 * Build a "YYYY-MM-DD" key from {year,month,day}.
 */
function isoKey(cal) {
  return (
    `${cal.year}-${String(cal.month).padStart(2, "0")}-` +
    `${String(cal.day).padStart(2, "0")}`
  );
}

/**
 * Slice one working interval into slots.
 *
 * @param {number} intervalStart  minutes-from-local-midnight
 * @param {number} intervalEnd    minutes-from-local-midnight
 * @param {number} slotDuration   minutes
 * @param {number} buffer         minutes between consecutive slots
 * @returns {Array<{startMinute:number,endMinute:number}>}
 *
 * Step is (slotDuration + buffer). A slot fits while
 * slotStart + slotDuration <= intervalEnd. The buffer is the gap AFTER a
 * slot before the next one can start; it is not appended after the last
 * slot (the interval simply ends).
 */
function sliceInterval(intervalStart, intervalEnd, slotDuration, buffer) {
  const slots = [];
  if (
    !Number.isFinite(intervalStart) ||
    !Number.isFinite(intervalEnd) ||
    slotDuration <= 0 ||
    intervalEnd <= intervalStart
  ) {
    return slots;
  }
  const step = slotDuration + Math.max(0, buffer);
  let start = intervalStart;
  // Guard against a zero/negative step producing an infinite loop.
  if (step <= 0) return slots;
  while (start + slotDuration <= intervalEnd) {
    slots.push({ startMinute: start, endMinute: start + slotDuration });
    start += step;
  }
  return slots;
}

/**
 * Given the resolved intervals for a single date, produce the slot list,
 * each slot decorated with its absolute UTC start instant.
 *
 * @param {Array<{startMinute,endMinute}>} intervals  resolved working intervals
 * @param {object} cal              { year, month, day }
 * @param {string} timeZone         clinic IANA tz
 * @param {number} slotDuration     minutes
 * @param {number} buffer           minutes
 * @returns {Array<{startMinute,endMinute,startUTC:string}>}
 */
function slotsForDate(intervals, cal, timeZone, slotDuration, buffer) {
  // UTC instant of this date's LOCAL midnight — the anchor for converting
  // a minutes-from-midnight value into an absolute instant.
  const localMidnightUTC = localMidnightToUTC(
    timeZone,
    cal.year,
    cal.month,
    cal.day,
  );

  const out = [];
  // Sort intervals so the emitted slots are chronological even if the
  // stored intervals weren't ordered.
  const sorted = [...intervals].sort((a, b) => a.startMinute - b.startMinute);
  for (const iv of sorted) {
    const sliced = sliceInterval(
      iv.startMinute,
      iv.endMinute,
      slotDuration,
      buffer,
    );
    for (const s of sliced) {
      out.push({
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        // local-midnight instant + startMinute minutes = slot start instant
        startUTC: new Date(
          localMidnightUTC.getTime() + s.startMinute * 60 * 1000,
        ).toISOString(),
      });
    }
  }
  return out;
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Compute bookable slots for a doctor across a date window.
 *
 * @param {string} doctorId
 * @param {object} range  { from: "YYYY-MM-DD", to: "YYYY-MM-DD" } — raw query
 * @returns {Promise<{
 *   doctorId: string,
 *   slotDurationMinutes: number,
 *   bufferMinutes: number,
 *   timezone: string,
 *   days: Array<{ date: string, slots: Array<{startMinute,endMinute,startUTC}> }>
 * }>}
 *
 * NOTE: does not subtract booked appointments (day 4). Every slot here is
 * "the doctor works then".
 */
export async function computeSlots(doctorId, range) {
  const clinicId = requireClinicId();

  if (!mongoose.isValidObjectId(doctorId)) {
    throw new ValidationError("doctorId is not a valid id", {
      field: "doctorId",
      received: doctorId,
    });
  }

  // ─── Validate the window ───
  const from = parseDateString(range?.from, "from");
  const to = parseDateString(range?.to, "to");

  const fromKey = Date.UTC(from.year, from.month - 1, from.day);
  const toKey = Date.UTC(to.year, to.month - 1, to.day);
  if (fromKey > toKey) {
    throw new ValidationError("from must be on or before to", {
      field: "from",
      from: from.iso,
      to: to.iso,
    });
  }
  const windowDays = Math.round((toKey - fromKey) / MS_PER_DAY) + 1;
  if (windowDays > MAX_WINDOW_DAYS) {
    throw new ValidationError(
      `Date window too large: ${windowDays} days (max ${MAX_WINDOW_DAYS})`,
      { field: "to", windowDays, max: MAX_WINDOW_DAYS },
    );
  }

  const timeZone = await resolveClinicTimezone(clinicId);

  // ─── Load the weekly pattern ───
  const schedule = await _getRawScheduleForSlots(doctorId, clinicId);

  // No schedule, or schedule explicitly inactive → every day is empty.
  const scheduleActive =
    schedule &&
    schedule.isActive !== false &&
    Array.isArray(schedule.weeklyHours);

  const slotDuration = (schedule && Number(schedule.slotDurationMinutes)) || 30;
  const buffer = (schedule && Number(schedule.bufferMinutes)) || 0;

  // Index weeklyHours by weekday for O(1) lookup.
  const weekdayMap = new Map(); // weekday → intervals[]
  if (scheduleActive) {
    for (const entry of schedule.weeklyHours) {
      weekdayMap.set(entry.weekday, entry.intervals || []);
    }
  }

  // ─── Load exceptions for the window ───
  // Window bounds as UTC instants of local midnight (inclusive both ends).
  const fromUTC = localMidnightToUTC(timeZone, from.year, from.month, from.day);
  const toUTC = localMidnightToUTC(timeZone, to.year, to.month, to.day);

  const exceptions = await _getRawExceptionsForSlots(
    doctorId,
    clinicId,
    fromUTC,
    toUTC,
  );

  // Index exceptions by their "YYYY-MM-DD" local key. The stored `date` is
  // local midnight as UTC; read it back in the clinic tz to get the key.
  const exceptionMap = new Map(); // "YYYY-MM-DD" → exception doc
  const keyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  for (const exc of exceptions) {
    if (!exc.date) continue;
    // en-CA formats as "YYYY-MM-DD"; add 6h probe to stay inside the day.
    const probe = new Date(new Date(exc.date).getTime() + 6 * 60 * 60 * 1000);
    const key = keyFmt.format(probe);
    exceptionMap.set(key, exc);
  }

  // ─── Walk every date in the window, resolve, slice ───
  const days = [];
  for (const cal of iterateCalendarDays(from, to)) {
    const key = isoKey(cal);
    let resolvedIntervals = [];

    const exc = exceptionMap.get(key);
    if (exc) {
      if (exc.type === "day_off") {
        // Doctor not working that date — no slots.
        resolvedIntervals = [];
      } else if (exc.type === "custom") {
        // Custom hours fully replace the weekday pattern.
        resolvedIntervals = exc.intervals || [];
      }
    } else if (scheduleActive) {
      // Fall back to the weekly pattern for this date's weekday.
      const weekday = weekdayInTimezone(timeZone, cal.year, cal.month, cal.day);
      resolvedIntervals = weekdayMap.get(weekday) || [];
    }
    // else: no exception + no active schedule → resolvedIntervals stays []

    const slots =
      resolvedIntervals.length > 0
        ? slotsForDate(resolvedIntervals, cal, timeZone, slotDuration, buffer)
        : [];

    days.push({ date: key, slots });
  }

  return {
    doctorId: String(doctorId),
    slotDurationMinutes: slotDuration,
    bufferMinutes: buffer,
    timezone: timeZone,
    days,
  };
}

// Exported for unit tests.
export { sliceInterval, weekdayInTimezone, slotsForDate };

export default {
  computeSlots,
  sliceInterval,
  weekdayInTimezone,
  slotsForDate,
};
