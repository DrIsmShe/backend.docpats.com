// server/common/utils/timezone.js
//
// Timezone helpers for clinic operations.
// Storage convention: ALL dates in DB are UTC.
// UI convention: convert to clinic's local timezone for display.
//
// Uses luxon (modern, immutable replacement for moment.js).
//
// Usage:
//   import { localToUtc, utcToLocal, formatLocal } from "../../common/utils/timezone.js";
//   const utc = localToUtc("2026-05-15 10:00", "Asia/Baku");  // → ISO UTC
//   const local = utcToLocal(new Date(), "Asia/Baku");
//   const display = formatLocal(new Date(), "Asia/Baku", "dd MMM HH:mm");

import { DateTime } from "luxon";

const DEFAULT_ZONE = "UTC";

/**
 * Validate IANA timezone string.
 */
export function isValidTimezone(tz) {
  if (!tz || typeof tz !== "string") return false;
  const dt = DateTime.now().setZone(tz);
  return dt.isValid;
}

/**
 * Convert a local-time string to UTC Date.
 *
 * @param {string} localStr  e.g. "2026-05-15 10:00", "2026-05-15T10:00", "10:00"
 * @param {string} clinicTz  IANA tz like "Asia/Baku"
 * @param {string} [refDate]  optional reference date for time-only inputs
 * @returns {Date}  JS Date in UTC
 */
export function localToUtc(localStr, clinicTz, refDate = null) {
  if (!isValidTimezone(clinicTz)) {
    throw new Error(`Invalid timezone: ${clinicTz}`);
  }

  let isoStr = localStr.trim();
  // If only time given (HH:mm), prepend reference date or today
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(isoStr)) {
    const ref = refDate
      ? DateTime.fromJSDate(new Date(refDate), { zone: clinicTz })
      : DateTime.now().setZone(clinicTz);
    const [h, m, s] = isoStr.split(":");
    const dt = ref.set({
      hour: +h,
      minute: +m,
      second: +(s || 0),
      millisecond: 0,
    });
    if (!dt.isValid) throw new Error(`Invalid time: ${localStr}`);
    return dt.toUTC().toJSDate();
  }

  // Otherwise parse as full local datetime
  const normalized = isoStr.includes("T") ? isoStr : isoStr.replace(" ", "T");
  const dt = DateTime.fromISO(normalized, { zone: clinicTz });
  if (!dt.isValid) {
    throw new Error(`Invalid datetime: ${localStr} (${dt.invalidReason})`);
  }
  return dt.toUTC().toJSDate();
}

/**
 * Convert UTC Date → DateTime in clinic timezone.
 *
 * @param {Date|string} utc
 * @param {string} clinicTz
 * @returns {DateTime}  luxon DateTime in clinicTz
 */
export function utcToLocal(utc, clinicTz) {
  if (!isValidTimezone(clinicTz)) {
    throw new Error(`Invalid timezone: ${clinicTz}`);
  }
  const dt =
    utc instanceof Date
      ? DateTime.fromJSDate(utc, { zone: "UTC" })
      : DateTime.fromISO(utc, { zone: "UTC" });
  if (!dt.isValid) {
    throw new Error(`Invalid UTC date: ${utc}`);
  }
  return dt.setZone(clinicTz);
}

/**
 * Format UTC Date in clinic's local timezone with given format.
 *
 * @param {Date} utc
 * @param {string} clinicTz
 * @param {string} fmt  luxon format token, e.g. "dd MMM yyyy HH:mm"
 * @returns {string}
 */
export function formatLocal(utc, clinicTz, fmt = "yyyy-LL-dd HH:mm") {
  return utcToLocal(utc, clinicTz).toFormat(fmt);
}

/**
 * Get current time in clinic timezone (returns DateTime).
 */
export function nowInZone(clinicTz) {
  return DateTime.now().setZone(clinicTz || DEFAULT_ZONE);
}

/**
 * Start of day in clinic timezone, returned as UTC Date.
 * Useful for "fetch all today's appointments" queries.
 */
export function startOfDayUtc(clinicTz, dateRef = null) {
  const ref = dateRef
    ? DateTime.fromJSDate(new Date(dateRef), { zone: clinicTz })
    : DateTime.now().setZone(clinicTz);
  return ref.startOf("day").toUTC().toJSDate();
}

/**
 * End of day in clinic timezone, returned as UTC Date.
 */
export function endOfDayUtc(clinicTz, dateRef = null) {
  const ref = dateRef
    ? DateTime.fromJSDate(new Date(dateRef), { zone: clinicTz })
    : DateTime.now().setZone(clinicTz);
  return ref.endOf("day").toUTC().toJSDate();
}

/**
 * Add minutes to a UTC date.
 */
export function addMinutes(utc, minutes) {
  return DateTime.fromJSDate(utc, { zone: "UTC" }).plus({ minutes }).toJSDate();
}

/**
 * Compare two UTC dates: a > b (returns boolean).
 */
export function isAfter(a, b) {
  return a.getTime() > b.getTime();
}

/**
 * Difference in minutes between two UTC dates.
 */
export function diffMinutes(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 60000);
}
