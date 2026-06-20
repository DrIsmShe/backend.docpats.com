// server/modules/clinic/clinic-appointments/validators/appointment.validator.js
//
// Input validators for the ClinicAppointment endpoints.
//
// Style follows the day-1/day-2 validators in this module:
//   - pure functions, no I/O
//   - throw ValidationError({ field, ... }) on first problem
//   - normalize / coerce types and return a clean object that the service
//     can pass to the model without re-checking
//
// The controller wraps these with the `parse(schema, source, label)`
// helper used elsewhere in clinic-controllers.

import mongoose from "mongoose";

import { ValidationError } from "../../../../common/utils/errors.js";
import {
  APPOINTMENT_STATUSES,
  REASON_MAX_LENGTH,
} from "../models/clinicAppointment.model.js";

// ─── Tunables ─────────────────────────────────────────────────

// Cap how far ahead an appointment can be booked. Stops obvious typos
// ("2226-05-18") from making it into the DB.
const MAX_BOOKING_HORIZON_DAYS = 365;

// Cap a single appointment's duration. Two-day appointments aren't a thing
// in this product; mostly a guard against `endUTC` typos.
const MAX_APPOINTMENT_DURATION_MINUTES = 24 * 60; // 24h

const MIN_APPOINTMENT_DURATION_MINUTES = 5;

// ─── Shared helpers ───────────────────────────────────────────

function requireObjectId(raw, fieldPath) {
  if (!raw || !mongoose.isValidObjectId(raw)) {
    throw new ValidationError(`${fieldPath} is not a valid id`, {
      field: fieldPath,
      received: raw,
    });
  }
  return String(raw);
}

// Optional ObjectId: undefined / null / "" → null (field omitted).
// Anything present must be a valid ObjectId.
function optionalObjectId(raw, fieldPath) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (!mongoose.isValidObjectId(raw)) {
    throw new ValidationError(`${fieldPath} is not a valid id`, {
      field: fieldPath,
      received: raw,
    });
  }
  return String(raw);
}

function requireDateInstant(raw, fieldPath) {
  if (raw === undefined || raw === null || raw === "") {
    throw new ValidationError(`${fieldPath} is required`, {
      field: fieldPath,
    });
  }
  // Accept ISO 8601 string or already-a-Date / number.
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${fieldPath} is not a valid timestamp`, {
      field: fieldPath,
      received: raw,
    });
  }
  return d;
}

function optionalString(raw, fieldPath, { maxLength } = {}) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new ValidationError(`${fieldPath} must be a string`, {
      field: fieldPath,
      received: typeof raw,
    });
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (typeof maxLength === "number" && trimmed.length > maxLength) {
    throw new ValidationError(
      `${fieldPath} exceeds max length of ${maxLength}`,
      { field: fieldPath, length: trimmed.length },
    );
  }
  return trimmed;
}

// "YYYY-MM-DD" + calendar sanity. Reused from prior validators in spirit;
// kept local to avoid cross-imports just for a 10-line check.
function requireISODate(raw, fieldPath) {
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
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(year, month, 0).getDate() ||
    year < 2000 ||
    year > 2100
  ) {
    throw new ValidationError(`${fieldPath} is not a real calendar date`, {
      field: fieldPath,
      received: raw,
    });
  }
  return trimmed;
}

// ─── Range / horizon guards for an appointment instant pair ───
function assertSaneInterval(startUTC, endUTC, label = "") {
  const durationMs = endUTC.getTime() - startUTC.getTime();
  if (durationMs <= 0) {
    throw new ValidationError(`${label}endUTC must be after startUTC`, {
      field: "endUTC",
    });
  }
  const durationMin = durationMs / 60000;
  if (durationMin < MIN_APPOINTMENT_DURATION_MINUTES) {
    throw new ValidationError(
      `${label}appointment must be at least ${MIN_APPOINTMENT_DURATION_MINUTES} minutes long`,
      { field: "endUTC", durationMinutes: durationMin },
    );
  }
  if (durationMin > MAX_APPOINTMENT_DURATION_MINUTES) {
    throw new ValidationError(
      `${label}appointment is too long (max ${MAX_APPOINTMENT_DURATION_MINUTES} minutes)`,
      { field: "endUTC", durationMinutes: durationMin },
    );
  }

  const horizon = Date.now() + MAX_BOOKING_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  if (startUTC.getTime() > horizon) {
    throw new ValidationError(
      `${label}startUTC is too far in the future (max ${MAX_BOOKING_HORIZON_DAYS} days ahead)`,
      { field: "startUTC" },
    );
  }
}

// ════════════════════════════════════════════════════════════════
//  Validators
// ════════════════════════════════════════════════════════════════

/**
 * Validate input for POST /appointments
 *
 * Expected raw shape:
 *   {
 *     doctorId, patientId,
 *     startUTC, endUTC,                  // ISO strings or Date
 *     departmentId? : ObjectId | null,   // optional org link (validated
 *                                         // for clinic-ownership in service)
 *     roomId?       : ObjectId | null,   // optional room link (validated
 *                                         // for clinic-ownership in service)
 *     reason?    : string (PHI; will be encrypted by the service)
 *   }
 *
 * Returns a normalized object the service can hand straight to the model.
 * Note: localDate / startMinute / endMinute are NOT taken from the client;
 * the service derives them from startUTC/endUTC + clinic timezone.
 */
export function validateCreateAppointment(raw) {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("Request body must be an object");
  }

  const doctorId = requireObjectId(raw.doctorId, "doctorId");
  const patientId = requireObjectId(raw.patientId, "patientId");

  const startUTC = requireDateInstant(raw.startUTC, "startUTC");
  const endUTC = requireDateInstant(raw.endUTC, "endUTC");
  assertSaneInterval(startUTC, endUTC);

  const departmentId = optionalObjectId(raw.departmentId, "departmentId");
  const roomId = optionalObjectId(raw.roomId, "roomId");

  const reason = optionalString(raw.reason, "reason", {
    maxLength: REASON_MAX_LENGTH,
  });

  return {
    doctorId,
    patientId,
    startUTC,
    endUTC,
    departmentId, // service validates ownership + writes (null = no department)
    roomId, // service validates ownership + writes (null = no room)
    reason, // service encrypts → reasonEncrypted
  };
}

/**
 * Validate input for PATCH /appointments/:id/reschedule
 *
 * Reschedule moves the time and (optionally) updates the reason and/or
 * department; identity fields (doctorId/patientId) are NOT mutable here —
 * that would be a new appointment, not a reschedule.
 *
 *   { startUTC, endUTC, reason?, departmentId? }
 *
 * departmentId semantics on reschedule:
 *   - omitted        → department left unchanged
 *   - null / ""      → department cleared
 *   - valid ObjectId → department set (service validates ownership)
 */
export function validateRescheduleAppointment(raw) {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("Request body must be an object");
  }

  const startUTC = requireDateInstant(raw.startUTC, "startUTC");
  const endUTC = requireDateInstant(raw.endUTC, "endUTC");
  assertSaneInterval(startUTC, endUTC, "reschedule: ");

  const out = { startUTC, endUTC };
  if (raw.reason !== undefined) {
    out.reason = optionalString(raw.reason, "reason", {
      maxLength: REASON_MAX_LENGTH,
    });
  }
  // Only include departmentId in the output if the caller mentioned it,
  // so an omitted field leaves the existing value untouched.
  if (raw.departmentId !== undefined) {
    out.departmentId = optionalObjectId(raw.departmentId, "departmentId");
  }
  // Same omitted-leaves-unchanged semantics for roomId.
  if (raw.roomId !== undefined) {
    out.roomId = optionalObjectId(raw.roomId, "roomId");
  }
  return out;
}

/**
 * Validate input for PATCH /appointments/:id/status
 *
 *   { status: "checked_in" | "completed" | "cancelled" | "no_show",
 *     cancelReason? }
 *
 * Transition legality (scheduled → checked_in, etc.) is enforced in the
 * service layer; here we only check input shape. cancelReason is allowed
 * only when status === "cancelled".
 */
export function validateStatusChange(raw) {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("Request body must be an object");
  }
  const status = raw.status;
  if (!APPOINTMENT_STATUSES.includes(status)) {
    throw new ValidationError("status is not a valid appointment status", {
      field: "status",
      received: status,
      allowed: [...APPOINTMENT_STATUSES],
    });
  }
  // "scheduled" cannot be set explicitly — it's the create default and
  // there's no legal transition INTO it. Reschedule moves time, not state.
  if (status === "scheduled") {
    throw new ValidationError(
      'status "scheduled" cannot be set explicitly; use reschedule to change timing',
      { field: "status" },
    );
  }

  const out = { status };

  if (status === "cancelled") {
    out.cancelReason = optionalString(raw.cancelReason, "cancelReason", {
      maxLength: 500,
    });
  } else if (raw.cancelReason !== undefined && raw.cancelReason !== null) {
    throw new ValidationError(
      "cancelReason is only allowed when status is 'cancelled'",
      { field: "cancelReason" },
    );
  }

  return out;
}

/**
 * Validate query for GET /appointments
 *
 * Two complementary modes — at least one filter is required:
 *   - by doctor + date window:  doctorId + from + to  (YYYY-MM-DD, inclusive)
 *   - by patient:               patientId  (returns recent ones, paginated)
 *
 * Optional `status` (single value) further narrows the result set.
 *
 * The window is bounded at 92 days (~3 months) — appointments are heavier
 * than slot computations, so we're stricter than the 62-day slot cap.
 */
export function validateListAppointments(raw) {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("Query params required");
  }

  const out = {};

  if (raw.doctorId) {
    out.doctorId = requireObjectId(raw.doctorId, "doctorId");
  }
  if (raw.patientId) {
    out.patientId = requireObjectId(raw.patientId, "patientId");
  }
  if (!out.doctorId && !out.patientId) {
    throw new ValidationError(
      "At least one of doctorId or patientId is required",
      { field: "doctorId" },
    );
  }

  if (out.doctorId) {
    // doctor-mode requires the date window so we never load "all
    // appointments ever" for one doctor
    out.from = requireISODate(raw.from, "from");
    out.to = requireISODate(raw.to, "to");
    if (out.from > out.to) {
      throw new ValidationError("from must be on or before to", {
        field: "from",
      });
    }
    // 92-day cap (rough — string compare suffices for same-format dates)
    const fromD = new Date(out.from);
    const toD = new Date(out.to);
    const windowDays =
      Math.round((toD.getTime() - fromD.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (windowDays > 92) {
      throw new ValidationError("Date window too large (max 92 days)", {
        field: "to",
        windowDays,
      });
    }
  } else {
    // patient-mode: pagination defaults — service caps limit at 100
    if (raw.limit !== undefined) {
      const n = parseInt(raw.limit, 10);
      if (Number.isNaN(n) || n < 1 || n > 100) {
        throw new ValidationError("limit must be an integer 1..100", {
          field: "limit",
          received: raw.limit,
        });
      }
      out.limit = n;
    }
    if (raw.before !== undefined && raw.before !== "") {
      const d = new Date(raw.before);
      if (Number.isNaN(d.getTime())) {
        throw new ValidationError("before is not a valid timestamp", {
          field: "before",
        });
      }
      out.before = d;
    }
  }

  if (raw.status !== undefined && raw.status !== "") {
    if (!APPOINTMENT_STATUSES.includes(raw.status)) {
      throw new ValidationError("status is not a valid appointment status", {
        field: "status",
        received: raw.status,
      });
    }
    out.status = raw.status;
  }

  return out;
}

/**
 * Validate query for GET /appointments/slots-free — the bookable-slots
 * wrapper that filters out time taken by active appointments.
 *
 *   ?doctorId=&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Same shape as the day-3 /slots endpoint; service composes computeSlots
 * with the active-appointments query.
 */
export function validateFreeSlotsQuery(raw) {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("Query params required");
  }
  return {
    doctorId: requireObjectId(raw.doctorId, "doctorId"),
    from: requireISODate(raw.from, "from"),
    to: requireISODate(raw.to, "to"),
  };
}
