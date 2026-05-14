// server/modules/clinic/clinic-appointments/validators/doctorSchedule.validator.js
//
// Validation for the "upsert a doctor's weekly schedule" payload.
//
// Philosophy:
//   - Pure functions. No DB access, no tenant context — that lives in the
//     service layer. This file only answers: "is this request body shaped
//     correctly and internally consistent?"
//   - On any problem we throw ValidationError (from common/utils/errors.js)
//     with a machine-readable `details` object so the frontend can point at
//     the exact field. The global errorHandler renders it as HTTP 400.
//   - We normalize as we validate: the returned object is clean, typed, and
//     safe to hand straight to the service. The controller should use the
//     RETURN VALUE, not the raw req.body.
//
// Shape of the expected payload (PUT /appointments/schedule/:doctorId):
//
//   {
//     weeklyHours: [
//       { weekday: 1, intervals: [ { startMinute: 540, endMinute: 780 },
//                                  { startMinute: 840, endMinute: 1080 } ] },
//       { weekday: 2, intervals: [ { startMinute: 540, endMinute: 1080 } ] },
//       ...
//     ],
//     slotDurationMinutes: 30,   // optional, default 30
//     bufferMinutes: 0,          // optional, default 0
//     isActive: true             // optional, default true
//   }
//
// weekday: 0=Sunday .. 6=Saturday (JS Date.getDay() convention).
// startMinute / endMinute: minutes from local midnight, 0..1440.

import { ValidationError } from "../../../../common/utils/errors.js";
import { MINUTES_IN_DAY } from "../models/clinicDoctorSchedule.model.js";

// ─── Bounds (kept in sync with the model's schema constraints) ────────

const SLOT_MIN = 5;
const SLOT_MAX = 240;
const BUFFER_MIN = 0;
const BUFFER_MAX = 120;
const DEFAULT_SLOT = 30;
const DEFAULT_BUFFER = 0;

// ─── Small internal helpers ───────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Coerce a value to an integer, or throw ValidationError.
 * Rejects floats, NaN, strings that aren't clean integers, etc.
 */
function asInt(value, fieldPath) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return parseInt(value.trim(), 10);
  }
  throw new ValidationError(`${fieldPath} must be an integer`, {
    field: fieldPath,
    received: value,
  });
}

/**
 * Validate one interval object → returns a clean { startMinute, endMinute }.
 * `path` is used for human-readable error messages, e.g.
 * "weeklyHours[1].intervals[0]".
 */
function validateInterval(raw, path) {
  if (!isPlainObject(raw)) {
    throw new ValidationError(`${path} must be an object`, { field: path });
  }

  const startMinute = asInt(raw.startMinute, `${path}.startMinute`);
  const endMinute = asInt(raw.endMinute, `${path}.endMinute`);

  if (startMinute < 0 || startMinute > MINUTES_IN_DAY - 1) {
    throw new ValidationError(
      `${path}.startMinute must be between 0 and ${MINUTES_IN_DAY - 1}`,
      { field: `${path}.startMinute`, received: startMinute },
    );
  }
  if (endMinute < 1 || endMinute > MINUTES_IN_DAY) {
    throw new ValidationError(
      `${path}.endMinute must be between 1 and ${MINUTES_IN_DAY}`,
      { field: `${path}.endMinute`, received: endMinute },
    );
  }
  if (startMinute >= endMinute) {
    throw new ValidationError(
      `${path}: startMinute (${startMinute}) must be strictly less than endMinute (${endMinute})`,
      { field: path, startMinute, endMinute },
    );
  }

  return { startMinute, endMinute };
}

/**
 * Validate the intervals array of a single weekday.
 *  - each interval is individually valid
 *  - intervals do NOT overlap each other
 *  - returned intervals are sorted ascending by startMinute (so downstream
 *    slot generation can assume order)
 *
 * Empty array is allowed → means "not working that weekday". We don't reject
 * it; it's a meaningful state.
 */
function validateIntervalsOfDay(rawIntervals, dayPath) {
  if (rawIntervals === undefined || rawIntervals === null) return [];
  if (!Array.isArray(rawIntervals)) {
    throw new ValidationError(`${dayPath}.intervals must be an array`, {
      field: `${dayPath}.intervals`,
    });
  }

  const clean = rawIntervals.map((iv, i) =>
    validateInterval(iv, `${dayPath}.intervals[${i}]`),
  );

  // Sort by start, then scan for overlaps. After sorting, an overlap exists
  // iff some interval starts before the previous one ended.
  clean.sort((a, b) => a.startMinute - b.startMinute);
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    const cur = clean[i];
    if (cur.startMinute < prev.endMinute) {
      throw new ValidationError(
        `${dayPath}.intervals: overlapping intervals ` +
          `(${prev.startMinute}-${prev.endMinute}) and ` +
          `(${cur.startMinute}-${cur.endMinute})`,
        { field: `${dayPath}.intervals`, conflict: [prev, cur] },
      );
    }
  }

  return clean;
}

/**
 * Validate the whole weeklyHours array → returns a clean, deduplicated,
 * weekday-sorted array. Each weekday may appear at most once.
 */
function validateWeeklyHours(rawWeekly) {
  if (rawWeekly === undefined || rawWeekly === null) {
    // Absent weeklyHours => clear the schedule (doctor works no days).
    // We allow it; the service decides whether that's meaningful.
    return [];
  }
  if (!Array.isArray(rawWeekly)) {
    throw new ValidationError("weeklyHours must be an array", {
      field: "weeklyHours",
    });
  }
  if (rawWeekly.length > 7) {
    throw new ValidationError("weeklyHours cannot have more than 7 entries", {
      field: "weeklyHours",
      received: rawWeekly.length,
    });
  }

  const seenWeekdays = new Set();
  const clean = [];

  rawWeekly.forEach((rawDay, i) => {
    const dayPath = `weeklyHours[${i}]`;
    if (!isPlainObject(rawDay)) {
      throw new ValidationError(`${dayPath} must be an object`, {
        field: dayPath,
      });
    }

    const weekday = asInt(rawDay.weekday, `${dayPath}.weekday`);
    if (weekday < 0 || weekday > 6) {
      throw new ValidationError(
        `${dayPath}.weekday must be between 0 (Sunday) and 6 (Saturday)`,
        { field: `${dayPath}.weekday`, received: weekday },
      );
    }
    if (seenWeekdays.has(weekday)) {
      throw new ValidationError(
        `weeklyHours: weekday ${weekday} appears more than once`,
        { field: "weeklyHours", duplicateWeekday: weekday },
      );
    }
    seenWeekdays.add(weekday);

    const intervals = validateIntervalsOfDay(rawDay.intervals, dayPath);
    clean.push({ weekday, intervals });
  });

  clean.sort((a, b) => a.weekday - b.weekday);
  return clean;
}

/**
 * Validate an optional integer field that has a default and a [min,max] range.
 * Returns the parsed value, or the default when the field is absent.
 */
function validateBoundedInt(raw, fieldName, min, max, defaultValue) {
  if (raw === undefined || raw === null) return defaultValue;
  const val = asInt(raw, fieldName);
  if (val < min || val > max) {
    throw new ValidationError(
      `${fieldName} must be between ${min} and ${max}`,
      { field: fieldName, received: val },
    );
  }
  return val;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Validate + normalize the upsert-schedule payload.
 *
 * @param {object} body  raw req.body
 * @returns {{
 *   weeklyHours: Array<{weekday:number, intervals:Array<{startMinute:number,endMinute:number}>}>,
 *   slotDurationMinutes: number,
 *   bufferMinutes: number,
 *   isActive: boolean
 * }}
 * @throws {ValidationError} on any structural or semantic problem
 */
export function validateUpsertSchedule(body) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be a JSON object", {
      field: "(root)",
    });
  }

  const weeklyHours = validateWeeklyHours(body.weeklyHours);

  const slotDurationMinutes = validateBoundedInt(
    body.slotDurationMinutes,
    "slotDurationMinutes",
    SLOT_MIN,
    SLOT_MAX,
    DEFAULT_SLOT,
  );

  const bufferMinutes = validateBoundedInt(
    body.bufferMinutes,
    "bufferMinutes",
    BUFFER_MIN,
    BUFFER_MAX,
    DEFAULT_BUFFER,
  );

  // Cross-field sanity: a slot must fit inside the SHORTEST configured
  // interval, otherwise that interval can never produce a single slot and
  // the schedule is effectively misconfigured. We only warn-by-rejecting
  // when there IS at least one interval — an empty schedule is fine.
  let shortestInterval = Infinity;
  for (const day of weeklyHours) {
    for (const iv of day.intervals) {
      const len = iv.endMinute - iv.startMinute;
      if (len < shortestInterval) shortestInterval = len;
    }
  }
  if (shortestInterval !== Infinity && slotDurationMinutes > shortestInterval) {
    throw new ValidationError(
      `slotDurationMinutes (${slotDurationMinutes}) is longer than the ` +
        `shortest working interval (${shortestInterval} min) — no slot ` +
        `could ever be generated for that interval`,
      {
        field: "slotDurationMinutes",
        slotDurationMinutes,
        shortestInterval,
      },
    );
  }

  let isActive = true;
  if (body.isActive !== undefined && body.isActive !== null) {
    if (typeof body.isActive !== "boolean") {
      throw new ValidationError("isActive must be a boolean", {
        field: "isActive",
        received: body.isActive,
      });
    }
    isActive = body.isActive;
  }

  return { weeklyHours, slotDurationMinutes, bufferMinutes, isActive };
}

export default { validateUpsertSchedule };
