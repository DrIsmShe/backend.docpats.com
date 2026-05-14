// server/modules/clinic/clinic-appointments/validators/scheduleException.validator.js
//
// Validation for schedule-exception payloads (per-date overrides of a
// doctor's weekly pattern).
//
// Two entry points:
//   validateCreateException(body)      — one exception for one date
//   validateBulkDayOff(body)           — a date RANGE marked as day_off
//                                        (vacation), expanded into N single
//                                        exceptions by the service layer.
//
// Same philosophy as doctorSchedule.validator.js:
//   - Pure functions, no DB, no tenant context.
//   - Throw ValidationError (→ HTTP 400) with machine-readable `details`.
//   - Return clean, normalized objects; controller uses the RETURN VALUE.
//
// Date format on the wire: "YYYY-MM-DD" (calendar date, no time, no tz).
// The validator only checks the STRING shape and basic calendar sanity.
// Converting "YYYY-MM-DD" → a UTC-midnight Date in the clinic's timezone
// is the SERVICE's job (it needs Clinic.timezone, which validators don't
// have access to). So this file passes the date through as a validated
// string, plus parsed {year,month,day} ints for the service's convenience.
//
// Interval representation is identical to ClinicDoctorSchedule: minutes
// from local midnight, 0..1440, start < end, no overlaps.

import { ValidationError } from "../../../../common/utils/errors.js";
import { MINUTES_IN_DAY } from "../models/clinicDoctorSchedule.model.js";

// ─── Constants ────────────────────────────────────────────────────────

const EXCEPTION_TYPES = new Set(["day_off", "custom"]);
const NOTE_MAX = 200;

// Guard rail for bulk day-off: refuse absurd ranges. A single vacation
// request spanning more than this many days is almost certainly a bug or
// abuse — the service would otherwise create that many documents.
const BULK_MAX_DAYS = 90;

// ─── Small internal helpers ───────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

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
 * Validate a "YYYY-MM-DD" calendar-date string.
 * Checks: exact format, real month (1–12), real day-of-month for that
 * month/year (so "2026-02-30" is rejected). Returns { iso, year, month, day }.
 *
 * Does NOT do any timezone work — that's the service's job. This is purely
 * "is this a syntactically valid, real calendar date string?".
 */
function validateDateString(raw, fieldPath) {
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

  // Days in month — leap-year aware. new Date(year, month, 0) gives the
  // last day of `month` (month is 1-based here because day 0 of next).
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    throw new ValidationError(
      `${fieldPath}: day ${day} does not exist in ${m[1]}-${m[2]}`,
      { field: fieldPath, received: raw },
    );
  }

  // Sanity bound on year — catches typos like "0226" or "20226" that
  // somehow passed the regex (they wouldn't, but defensive).
  if (year < 2000 || year > 2100) {
    throw new ValidationError(`${fieldPath}: year out of supported range`, {
      field: fieldPath,
      received: raw,
    });
  }

  return { iso: trimmed, year, month, day };
}

/**
 * Validate one interval object → clean { startMinute, endMinute }.
 * Identical rules to doctorSchedule.validator.js.
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
 * Validate the intervals array of a "custom" exception:
 *  - non-empty (a custom day with no hours makes no sense — that's day_off)
 *  - each interval individually valid
 *  - no overlaps
 *  - returned sorted ascending by startMinute
 */
function validateCustomIntervals(rawIntervals, fieldPath) {
  if (!Array.isArray(rawIntervals) || rawIntervals.length === 0) {
    throw new ValidationError(
      `${fieldPath} must be a non-empty array when type is "custom"`,
      { field: fieldPath },
    );
  }

  const clean = rawIntervals.map((iv, i) =>
    validateInterval(iv, `${fieldPath}[${i}]`),
  );

  clean.sort((a, b) => a.startMinute - b.startMinute);
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    const cur = clean[i];
    if (cur.startMinute < prev.endMinute) {
      throw new ValidationError(
        `${fieldPath}: overlapping intervals ` +
          `(${prev.startMinute}-${prev.endMinute}) and ` +
          `(${cur.startMinute}-${cur.endMinute})`,
        { field: fieldPath, conflict: [prev, cur] },
      );
    }
  }

  return clean;
}

/**
 * Validate the optional `note` field. Returns trimmed string or null.
 */
function validateNote(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new ValidationError("note must be a string", {
      field: "note",
      received: raw,
    });
  }
  const trimmed = raw.trim();
  if (trimmed.length > NOTE_MAX) {
    throw new ValidationError(`note must be at most ${NOTE_MAX} characters`, {
      field: "note",
      length: trimmed.length,
    });
  }
  return trimmed.length === 0 ? null : trimmed;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Validate + normalize a single-exception create payload.
 *
 * Expected body:
 *   {
 *     date: "2026-05-20",          // required, YYYY-MM-DD
 *     type: "day_off" | "custom",  // required
 *     intervals: [ {startMinute,endMinute}, ... ],  // required iff type==="custom"
 *     note: "Annual leave"         // optional
 *   }
 *
 * @returns {{
 *   date: { iso:string, year:number, month:number, day:number },
 *   type: "day_off" | "custom",
 *   intervals: Array<{startMinute:number,endMinute:number}>,
 *   note: string|null
 * }}
 * @throws {ValidationError}
 */
export function validateCreateException(body) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be a JSON object", {
      field: "(root)",
    });
  }

  const date = validateDateString(body.date, "date");

  if (typeof body.type !== "string" || !EXCEPTION_TYPES.has(body.type)) {
    throw new ValidationError('type must be one of "day_off" or "custom"', {
      field: "type",
      received: body.type,
    });
  }
  const type = body.type;

  let intervals = [];
  if (type === "custom") {
    intervals = validateCustomIntervals(body.intervals, "intervals");
  } else {
    // type === "day_off": intervals must be absent or empty. Reject a
    // non-empty intervals array — it signals the caller is confused about
    // which type they want.
    if (
      body.intervals !== undefined &&
      body.intervals !== null &&
      !(Array.isArray(body.intervals) && body.intervals.length === 0)
    ) {
      throw new ValidationError(
        'intervals must be empty or omitted when type is "day_off"',
        { field: "intervals" },
      );
    }
  }

  const note = validateNote(body.note);

  return { date, type, intervals, note };
}

/**
 * Validate + normalize a bulk day-off (vacation) payload.
 *
 * Expected body:
 *   {
 *     startDate: "2026-07-01",   // required, YYYY-MM-DD, inclusive
 *     endDate:   "2026-07-14",   // required, YYYY-MM-DD, inclusive
 *     note: "Summer vacation"    // optional, applied to every generated day
 *   }
 *
 * The service expands [startDate..endDate] into one "day_off" exception per
 * calendar day. This validator only checks the range is well-formed and not
 * absurdly large — it does NOT enumerate the dates (that needs the clinic
 * timezone, which the service owns).
 *
 * @returns {{
 *   startDate: { iso, year, month, day },
 *   endDate:   { iso, year, month, day },
 *   note: string|null
 * }}
 * @throws {ValidationError}
 */
export function validateBulkDayOff(body) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be a JSON object", {
      field: "(root)",
    });
  }

  const startDate = validateDateString(body.startDate, "startDate");
  const endDate = validateDateString(body.endDate, "endDate");

  // Compare as plain UTC dates JUST for ordering + span check. This is a
  // coarse comparison — exact per-clinic-day enumeration happens in the
  // service with the real timezone. For "is start <= end" and "how many
  // days roughly", UTC midnight comparison is correct and tz-independent.
  const startUTC = Date.UTC(startDate.year, startDate.month - 1, startDate.day);
  const endUTC = Date.UTC(endDate.year, endDate.month - 1, endDate.day);

  if (startUTC > endUTC) {
    throw new ValidationError("startDate must be on or before endDate", {
      field: "startDate",
      startDate: startDate.iso,
      endDate: endDate.iso,
    });
  }

  const spanDays = Math.round((endUTC - startUTC) / (24 * 60 * 60 * 1000)) + 1;
  if (spanDays > BULK_MAX_DAYS) {
    throw new ValidationError(
      `Date range too large: ${spanDays} days (max ${BULK_MAX_DAYS})`,
      { field: "endDate", spanDays, max: BULK_MAX_DAYS },
    );
  }

  const note = validateNote(body.note);

  return { startDate, endDate, note };
}

/**
 * Validate a date-range query for listing exceptions (used by GET endpoints
 * and indirectly by slot generation). Both bounds required.
 *
 * @param {object} query  e.g. req.query { from: "2026-05-01", to: "2026-05-31" }
 * @returns {{ from: {iso,year,month,day}, to: {iso,year,month,day} }}
 * @throws {ValidationError}
 */
export function validateDateRangeQuery(query) {
  if (!isPlainObject(query)) {
    throw new ValidationError("Query parameters missing", { field: "(query)" });
  }
  const from = validateDateString(query.from, "from");
  const to = validateDateString(query.to, "to");

  const fromUTC = Date.UTC(from.year, from.month - 1, from.day);
  const toUTC = Date.UTC(to.year, to.month - 1, to.day);
  if (fromUTC > toUTC) {
    throw new ValidationError("from must be on or before to", {
      field: "from",
      from: from.iso,
      to: to.iso,
    });
  }

  return { from, to };
}

export default {
  validateCreateException,
  validateBulkDayOff,
  validateDateRangeQuery,
};
