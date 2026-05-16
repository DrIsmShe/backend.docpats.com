// server/modules/clinic/clinic-appointments/services/appointment.service.js
//
// Business logic for ClinicAppointment.
//
// Architecture (consistent with day-1/day-2 services in this module and
// with patient.service.js in clinic-patients):
//   - All queries rely on tenantScopedPlugin — clinicId is auto-filtered.
//     We never pass clinicId in queries; we only read it from
//     tenantContext for explicit safety checks and event payloads.
//   - Reason is PHI → encrypted at rest with the same AES-256-GCM
//     helpers used by ClinicPatient (encryptValue/decryptValue exported
//     from clinicPatient.model.js — single canonical implementation,
//     no duplication).
//   - Permissions are checked manually here, not via the RBAC catalog,
//     to stay self-contained (matches the day-1/day-2 pattern of
//     `assertDoctorOfClinic`).
//   - Status transitions are a finite-state machine: ALLOWED_TRANSITIONS
//     defines every legal edge. Anything else throws ConflictError.
//   - Conflict detection is a single MongoDB query against the
//     partial index "doctor_active_overlap" defined in the model.

import mongoose from "mongoose";

import ClinicAppointment, {
  APPOINTMENT_STATUSES,
  ACTIVE_STATUSES,
  REASON_MAX_LENGTH,
} from "../models/clinicAppointment.model.js";
import ClinicPatient, {
  encryptValue,
  decryptValue,
} from "../../clinic-patients/models/clinicPatient.model.js";
import ClinicMembership from "../../clinic-staff/models/clinicMembership.model.js";
import Clinic from "../../clinic-core/models/clinic.model.js";

import { eventBus, EVENTS } from "../../../../common/events/eventBus.js";
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from "../../../../common/utils/errors.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
  getCurrentActorType,
  getCurrentRole,
} from "../../../../common/context/tenantContext.js";
import logger from "../../../../common/logger.js";

import { localMidnightToUTC } from "./scheduleException.service.js";

const log = logger.child({ module: "clinic-appointments/service" });

// ─── Constants ────────────────────────────────────────────────────────

// Roles that can create / reschedule / cancel appointments. Doctors are
// NOT in this list — they can only flip status on their own appointments
// (see STATUS_TRANSITIONS_BY_ROLE below).
const WRITE_ROLES = new Set(["owner", "admin", "receptionist"]);

// Roles that can read appointments — every clinic role.
const READ_ROLES = new Set([
  "owner",
  "admin",
  "manager",
  "doctor",
  "receptionist",
  "nurse",
  "accountant",
  "pharmacist",
  "marketer",
]);

// Status FSM — directed graph of legal transitions.
// "scheduled" is reachable only on create (the default); explicit
// transitions INTO scheduled are forbidden by the validator.
const ALLOWED_TRANSITIONS = Object.freeze({
  scheduled: new Set(["checked_in", "cancelled", "no_show"]),
  checked_in: new Set(["completed", "cancelled", "no_show"]),
  completed: new Set(),
  cancelled: new Set(),
  no_show: new Set(),
});

// Reschedule is only legal while the appointment is still active.
const RESCHEDULABLE_STATUSES = new Set(ACTIVE_STATUSES);

const DEFAULT_TZ = "Asia/Baku";
const MAX_PATIENT_HISTORY_LIMIT = 100;

// ─── Tenant / actor helpers ───────────────────────────────────────────

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ForbiddenError("No active clinic context");
  return clinicId;
}

function requireActor() {
  const userId = getCurrentUserId();
  const actorType = getCurrentActorType();
  const role = getCurrentRole();
  if (!userId || !actorType || !role) {
    throw new ForbiddenError("Authenticated actor required");
  }
  return { userId, actorType, role };
}

function requireReadAccess() {
  const { role } = requireActor();
  if (!READ_ROLES.has(role)) {
    throw new ForbiddenError(`Role "${role}" cannot read appointments`);
  }
}

function requireWriteAccess() {
  const { role } = requireActor();
  if (!WRITE_ROLES.has(role)) {
    throw new ForbiddenError(
      `Role "${role}" cannot create or modify appointments — write access is limited to owner/admin/receptionist`,
    );
  }
}

// ─── Membership / participant validation ──────────────────────────────

/**
 * Confirm the target doctor has an active membership in this clinic as a
 * role that can hold a schedule (owner/admin/doctor). Mirrors the gate
 * used in the day-1 schedule service (`assertDoctorOfClinic`).
 */
async function assertDoctorOfClinic(doctorId, clinicId) {
  const membership = await ClinicMembership.findOne({
    userId: doctorId,
    clinicId,
    actorType: "user",
    isActive: true,
    leftAt: null,
  }).lean();
  if (!membership) {
    throw new NotFoundError(
      `Doctor is not an active member of this clinic (doctorId=${doctorId})`,
    );
  }
  if (!["owner", "admin", "doctor"].includes(membership.role)) {
    throw new ForbiddenError(
      `Member with role "${membership.role}" cannot be booked as a doctor`,
    );
  }
  return membership;
}

/**
 * Confirm the patient record exists in this clinic. tenantScopedPlugin
 * already restricts queries to the current clinic, so a successful find
 * proves cross-clinic isolation.
 */
async function assertPatientOfClinic(patientId) {
  const exists = await ClinicPatient.findById(patientId).select("_id").lean();
  if (!exists) {
    throw new NotFoundError(`Patient not found in this clinic`);
  }
}

// ─── Timezone / coordinate derivation ─────────────────────────────────

async function resolveClinicTimezone(clinicId) {
  const clinic = await Clinic.findById(clinicId).select("timezone").lean();
  if (!clinic) throw new NotFoundError("Clinic");
  return clinic.timezone || DEFAULT_TZ;
}

/**
 * Given an absolute UTC interval and the clinic's IANA timezone, derive
 * the clinic-local calendar coordinates we denormalize on the doc:
 *   - localDate: "YYYY-MM-DD" of the day the appointment STARTS on,
 *                in the clinic's tz
 *   - startMinute / endMinute: minutes-from-local-midnight relative to
 *                that localDate
 *
 * Reject appointments that span local midnight — they break the
 * "one appointment = one day" denormalization, and clinically there's
 * no reason to allow a single appointment crossing midnight.
 */
function deriveLocalCoords(startUTC, endUTC, timeZone) {
  // "YYYY-MM-DD" in the clinic tz. en-CA happens to format exactly that.
  const dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDate = dateFmt.format(startUTC);
  const localDateEnd = dateFmt.format(endUTC);

  // Same-day check. An appointment ending exactly at next-day 00:00 is
  // technically "the next day"; we treat that as crossing midnight too —
  // schedule it to end at 23:59 instead.
  if (localDate !== localDateEnd) {
    throw new ValidationError(
      "Appointment must start and end on the same clinic-local day",
      { field: "endUTC", localDate, localDateEnd },
    );
  }

  // To compute startMinute/endMinute we need the UTC instant of local
  // midnight for that date, then subtract.
  const [y, m, d] = localDate.split("-").map((s) => parseInt(s, 10));
  const localMidnightUTC = localMidnightToUTC(timeZone, y, m, d);
  const minutesFromMidnight = (dt) =>
    Math.round((dt.getTime() - localMidnightUTC.getTime()) / 60000);

  const startMinute = minutesFromMidnight(startUTC);
  const endMinute = minutesFromMidnight(endUTC);

  // Sanity belt — should be unreachable given the validator, but the
  // denormalised fields must always be sane.
  if (
    startMinute < 0 ||
    startMinute > 1439 ||
    endMinute < 1 ||
    endMinute > 1440 ||
    endMinute <= startMinute
  ) {
    throw new ValidationError(
      "Derived local minutes are out of range — DST or tz boundary?",
      { field: "startUTC", startMinute, endMinute },
    );
  }
  return { localDate, startMinute, endMinute };
}

// ─── Conflict detection ───────────────────────────────────────────────

/**
 * Throw ConflictError if the doctor has any ACTIVE appointment whose time
 * window overlaps [startUTC, endUTC). Excludes `excludeId` from the search
 * (used during reschedule so the appointment doesn't conflict with itself).
 *
 * Overlap rule: two intervals A and B overlap iff A.start < B.end && A.end > B.start.
 *
 * Hits the partial index `doctor_active_overlap`.
 */
async function assertNoConflict({
  clinicId,
  doctorId,
  startUTC,
  endUTC,
  excludeId = null,
}) {
  const filter = {
    doctorId,
    status: { $in: [...ACTIVE_STATUSES] },
    startUTC: { $lt: endUTC },
    endUTC: { $gt: startUTC },
  };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  // Suppress clinicId — tenantScopedPlugin attaches it. Belt-and-suspenders:
  // the model is tenant-scoped, so we won't see another clinic's docs anyway.
  // But the partial index includes clinicId for selectivity, so even though
  // the plugin handles isolation, the query plan still benefits.
  const conflict = await ClinicAppointment.findOne(filter)
    .select("_id startUTC endUTC status")
    .lean();
  if (conflict) {
    throw new ConflictError(
      "Doctor already has an appointment overlapping this time",
      {
        conflictingAppointmentId: String(conflict._id),
        conflictingStart: conflict.startUTC,
        conflictingEnd: conflict.endUTC,
      },
    );
  }
}

// ─── PHI helpers ──────────────────────────────────────────────────────

function encryptReason(text) {
  if (text === null || text === undefined || text === "") return null;
  return encryptValue(text);
}

function decryptReason(blob) {
  if (!blob) return null;
  try {
    return decryptValue(blob);
  } catch (e) {
    log.warn(
      { err: e.message },
      "Failed to decrypt appointment reason — returning null",
    );
    return null;
  }
}

// ─── DTO shaping ──────────────────────────────────────────────────────

/**
 * Convert a stored ClinicAppointment doc (lean or hydrated) into the API
 * response shape:
 *   - reason decrypted
 *   - ObjectIds stringified
 *   - hashes / encrypted blobs not exposed
 *
 * Never returns raw encrypted text.
 */
function toDTO(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    id: String(obj._id),
    clinicId: String(obj.clinicId),
    doctorId: String(obj.doctorId),
    patientId: String(obj.patientId),
    startUTC: obj.startUTC,
    endUTC: obj.endUTC,
    localDate: obj.localDate,
    startMinute: obj.startMinute,
    endMinute: obj.endMinute,
    reason: decryptReason(obj.reasonEncrypted),
    status: obj.status,
    checkedInAt: obj.checkedInAt || null,
    completedAt: obj.completedAt || null,
    cancelledAt: obj.cancelledAt || null,
    cancelReason: obj.cancelReason || null,
    noShowAt: obj.noShowAt || null,
    createdBy: obj.createdBy
      ? {
          actorType: obj.createdBy.actorType,
          actorId: String(obj.createdBy.actorId),
          role: obj.createdBy.role,
        }
      : null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

// ─── Patient-name enrichment ──────────────────────────────────────────
//
// Appointment DTOs need the patient's display name so the UI can render
// "Иван Тестов" instead of an opaque ObjectId. Mirror the pattern from
// patient.service's enrichWithCreatedByName: bulk fetch ClinicPatient
// records by id, decrypt firstName/lastName once, build a Map for O(1)
// lookup, attach to each DTO.
//
// PHI safety: the names are decrypted in memory and returned to the
// authenticated caller, who already has read access to these patients
// via the clinic tenant scope. No PHI leaves this process.

async function enrichDTOsWithPatientName(dtos) {
  if (!dtos || dtos.length === 0) return dtos;

  // Unique, non-null patient ids
  const ids = [...new Set(dtos.map((d) => d?.patientId).filter(Boolean))];
  if (ids.length === 0) return dtos;

  const patients = await ClinicPatient.find({ _id: { $in: ids } })
    .select("_id firstNameEncrypted lastNameEncrypted")
    .lean();

  const nameMap = new Map();
  for (const p of patients) {
    let firstName = null;
    let lastName = null;
    try {
      firstName = decryptValue(p.firstNameEncrypted) || null;
    } catch {
      /* ignore — leave null */
    }
    try {
      lastName = decryptValue(p.lastNameEncrypted) || null;
    } catch {
      /* ignore — leave null */
    }
    const display = [firstName, lastName].filter(Boolean).join(" ") || null;
    nameMap.set(String(p._id), display);
  }

  return dtos.map((d) =>
    d ? { ...d, patientName: nameMap.get(String(d.patientId)) || null } : d,
  );
}

// ════════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════════

/**
 * Create a new appointment.
 *
 * Input (already normalized by validateCreateAppointment):
 *   { doctorId, patientId, startUTC: Date, endUTC: Date, reason: string|null }
 *
 * Side effects: emits APPOINTMENT_CREATED on success.
 */
export async function createAppointment(input) {
  requireWriteAccess();
  const clinicId = requireClinicId();
  const { userId, actorType, role } = requireActor();

  const { doctorId, patientId, startUTC, endUTC, reason } = input;

  await assertDoctorOfClinic(doctorId, clinicId);
  await assertPatientOfClinic(patientId);

  const timeZone = await resolveClinicTimezone(clinicId);
  const { localDate, startMinute, endMinute } = deriveLocalCoords(
    startUTC,
    endUTC,
    timeZone,
  );

  await assertNoConflict({ clinicId, doctorId, startUTC, endUTC });

  const doc = await ClinicAppointment.create({
    clinicId,
    doctorId,
    patientId,
    startUTC,
    endUTC,
    localDate,
    startMinute,
    endMinute,
    reasonEncrypted: encryptReason(reason),
    status: "scheduled",
    createdBy: { actorType, actorId: userId, role },
  });

  log.info(
    {
      appointmentId: String(doc._id),
      doctorId: String(doctorId),
      patientId: String(patientId),
      localDate,
      startMinute,
    },
    "Appointment created",
  );

  eventBus.emitSafe(EVENTS.APPOINTMENT_CREATED, {
    appointmentId: String(doc._id),
    clinicId: String(clinicId),
    doctorId: String(doctorId),
    patientId: String(patientId),
    localDate,
    createdBy: String(userId),
    createdByRole: role,
  });

  return toDTO(doc);
}

/**
 * Fetch a single appointment by id (must belong to current clinic via
 * tenant scoping). Throws NotFoundError otherwise.
 */
export async function getAppointment(id) {
  requireReadAccess();
  requireClinicId();
  if (!mongoose.isValidObjectId(id)) {
    throw new ValidationError("Invalid appointment id", {
      field: "id",
      received: id,
    });
  }
  const doc = await ClinicAppointment.findById(id).lean();
  if (!doc) throw new NotFoundError("Appointment");
  const dto = toDTO(doc);
  const [enriched] = await enrichDTOsWithPatientName([dto]);
  return enriched;
}

/**
 * List appointments. Two complementary modes (the validator enforces that
 * exactly the right fields are present for each mode).
 *
 * Doctor mode  — { doctorId, from: "YYYY-MM-DD", to: "YYYY-MM-DD", status? }
 *   Returns ALL appointments for that doctor in the clinic-local window,
 *   ordered by startUTC ascending. Designed for a day/week schedule UI.
 *
 * Patient mode — { patientId, before?: Date, limit?, status? }
 *   Cursor-paginated history, most-recent first. Returns { items, nextBefore }.
 */
export async function listAppointments(query) {
  requireReadAccess();
  const clinicId = requireClinicId();

  const filter = {};
  if (query.status) filter.status = query.status;

  if (query.doctorId) {
    // Doctor mode — translate the local-day window into a UTC window.
    const timeZone = await resolveClinicTimezone(clinicId);
    const [fy, fm, fd] = query.from.split("-").map((s) => parseInt(s, 10));
    const [ty, tm, td] = query.to.split("-").map((s) => parseInt(s, 10));
    const windowStartUTC = localMidnightToUTC(timeZone, fy, fm, fd);
    // End of day "to" = start of (to + 1 day) — exclusive upper bound.
    const dayAfterTo = new Date(Date.UTC(ty, tm - 1, td + 1));
    const windowEndUTC = localMidnightToUTC(
      timeZone,
      dayAfterTo.getUTCFullYear(),
      dayAfterTo.getUTCMonth() + 1,
      dayAfterTo.getUTCDate(),
    );

    filter.doctorId = query.doctorId;
    filter.startUTC = { $gte: windowStartUTC, $lt: windowEndUTC };

    const items = await ClinicAppointment.find(filter)
      .sort({ startUTC: 1 })
      .lean();
    const dtos = await enrichDTOsWithPatientName(items.map(toDTO));
    return { items: dtos, count: dtos.length };
  }

  // Patient mode — cursor pagination.
  filter.patientId = query.patientId;
  if (query.before) filter.startUTC = { $lt: query.before };

  const limit = Math.min(query.limit || 50, MAX_PATIENT_HISTORY_LIMIT);
  const items = await ClinicAppointment.find(filter)
    .sort({ startUTC: -1 })
    .limit(limit)
    .lean();

  const nextBefore =
    items.length === limit && items[items.length - 1]
      ? items[items.length - 1].startUTC
      : null;

  const dtos = await enrichDTOsWithPatientName(items.map(toDTO));
  return {
    items: dtos,
    count: dtos.length,
    nextBefore,
  };
}

/**
 * Reschedule (move time, optionally update reason).
 *
 * Only legal while the appointment is still ACTIVE (scheduled or
 * checked_in). Terminal statuses (completed/cancelled/no_show) cannot be
 * rescheduled — use updateAppointmentReason for note corrections instead.
 */
export async function rescheduleAppointment(id, input) {
  requireWriteAccess();
  const clinicId = requireClinicId();

  if (!mongoose.isValidObjectId(id)) {
    throw new ValidationError("Invalid appointment id", {
      field: "id",
      received: id,
    });
  }

  const existing = await ClinicAppointment.findById(id);
  if (!existing) throw new NotFoundError("Appointment");

  if (!RESCHEDULABLE_STATUSES.has(existing.status)) {
    throw new ConflictError(
      `Cannot reschedule an appointment in status "${existing.status}"`,
      { currentStatus: existing.status },
    );
  }

  const timeZone = await resolveClinicTimezone(clinicId);
  const { localDate, startMinute, endMinute } = deriveLocalCoords(
    input.startUTC,
    input.endUTC,
    timeZone,
  );

  await assertNoConflict({
    clinicId,
    doctorId: existing.doctorId,
    startUTC: input.startUTC,
    endUTC: input.endUTC,
    excludeId: existing._id,
  });

  existing.startUTC = input.startUTC;
  existing.endUTC = input.endUTC;
  existing.localDate = localDate;
  existing.startMinute = startMinute;
  existing.endMinute = endMinute;

  // reason only re-encrypted if the caller actually supplied it
  if (Object.prototype.hasOwnProperty.call(input, "reason")) {
    existing.reasonEncrypted = encryptReason(input.reason);
  }

  await existing.save();

  log.info(
    {
      appointmentId: String(id),
      newLocalDate: localDate,
      newStartMinute: startMinute,
    },
    "Appointment rescheduled",
  );

  eventBus.emitSafe(EVENTS.APPOINTMENT_RESCHEDULED, {
    appointmentId: String(id),
    clinicId: String(existing.clinicId),
    doctorId: String(existing.doctorId),
    localDate,
  });

  return toDTO(existing);
}

/**
 * Update the reason/notes text on an appointment, regardless of its
 * current status. Useful for fixing typos on completed appointments or
 * adding notes on cancelled ones (medical records often need correction
 * after the fact).
 *
 * Does NOT change timing or status — purely a text edit on PHI.
 * Time-shifting always goes through rescheduleAppointment.
 */
export async function updateAppointmentReason(id, input) {
  requireWriteAccess();
  requireClinicId();

  if (!mongoose.isValidObjectId(id)) {
    throw new ValidationError("Invalid appointment id", {
      field: "id",
      received: id,
    });
  }

  if (!input || !Object.prototype.hasOwnProperty.call(input, "reason")) {
    throw new ValidationError("reason field is required", { field: "reason" });
  }
  if (
    typeof input.reason === "string" &&
    input.reason.length > REASON_MAX_LENGTH
  ) {
    throw new ValidationError(
      `reason exceeds max length of ${REASON_MAX_LENGTH}`,
      { field: "reason", length: input.reason.length },
    );
  }

  const existing = await ClinicAppointment.findById(id);
  if (!existing) throw new NotFoundError("Appointment");

  existing.reasonEncrypted = encryptReason(input.reason);
  await existing.save();

  log.info(
    { appointmentId: String(id), currentStatus: existing.status },
    "Appointment reason updated",
  );

  return toDTO(existing);
}

/**
 * Change the appointment status. Enforces the legal-transition FSM and
 * role-based restrictions:
 *   - owner / admin / receptionist  → any legal transition on any appointment
 *   - doctor                        → only their OWN appointments, and only
 *                                      transitions that make sense at-visit:
 *                                      checked_in, completed, no_show
 *   - other roles                   → forbidden
 *
 * Side effects: emits APPOINTMENT_STATUS_CHANGED, plus APPOINTMENT_CANCELLED
 * when transitioning to cancelled.
 */
export async function changeAppointmentStatus(id, input) {
  const { userId, role } = requireActor();
  requireClinicId();

  if (!mongoose.isValidObjectId(id)) {
    throw new ValidationError("Invalid appointment id", {
      field: "id",
      received: id,
    });
  }

  const existing = await ClinicAppointment.findById(id);
  if (!existing) throw new NotFoundError("Appointment");

  // Role gate
  const isOwnAppointment = String(existing.doctorId) === String(userId);
  const doctorAllowed = new Set(["checked_in", "completed", "no_show"]);

  if (WRITE_ROLES.has(role)) {
    // owner/admin/receptionist — anything legal goes
  } else if (role === "doctor" && isOwnAppointment) {
    if (!doctorAllowed.has(input.status)) {
      throw new ForbiddenError(
        `Doctors can only set status to checked_in, completed, or no_show`,
      );
    }
  } else {
    throw new ForbiddenError(
      `Role "${role}" cannot change appointment status${
        role === "doctor" ? " for an appointment they don't own" : ""
      }`,
    );
  }

  // FSM gate — legal-transition check
  const legalNext = ALLOWED_TRANSITIONS[existing.status];
  if (!legalNext || !legalNext.has(input.status)) {
    throw new ConflictError(
      `Illegal status transition: ${existing.status} → ${input.status}`,
      { from: existing.status, to: input.status },
    );
  }

  // Apply
  const now = new Date();
  const prevStatus = existing.status;
  existing.status = input.status;

  if (input.status === "checked_in") existing.checkedInAt = now;
  else if (input.status === "completed") existing.completedAt = now;
  else if (input.status === "no_show") existing.noShowAt = now;
  else if (input.status === "cancelled") {
    existing.cancelledAt = now;
    if (Object.prototype.hasOwnProperty.call(input, "cancelReason")) {
      existing.cancelReason = input.cancelReason || null;
    }
  }

  await existing.save();

  log.info(
    {
      appointmentId: String(id),
      from: prevStatus,
      to: input.status,
      byRole: role,
    },
    "Appointment status changed",
  );

  eventBus.emitSafe(EVENTS.APPOINTMENT_STATUS_CHANGED, {
    appointmentId: String(id),
    clinicId: String(existing.clinicId),
    doctorId: String(existing.doctorId),
    from: prevStatus,
    to: input.status,
    changedBy: String(userId),
  });

  if (input.status === "cancelled") {
    eventBus.emitSafe(EVENTS.APPOINTMENT_CANCELLED, {
      appointmentId: String(id),
      clinicId: String(existing.clinicId),
      doctorId: String(existing.doctorId),
      cancelReason: existing.cancelReason || null,
      cancelledBy: String(userId),
    });
  }

  return toDTO(existing);
}

// ════════════════════════════════════════════════════════════════
//  BOOKABLE-SLOTS WRAPPER
// ════════════════════════════════════════════════════════════════

/**
 * Compute slots that are BOTH (a) within the doctor's working schedule
 * and (b) NOT taken by an existing active appointment.
 *
 * This is the day-3 `computeSlots()` with booked-time subtraction layered
 * on top. The slot service stays "pure availability of the doctor"; this
 * wrapper is what callers should use for actual booking UIs.
 *
 * Input / output shape mirrors computeSlots exactly — same fields, just
 * fewer slots in the days[] array. Frontend can swap one endpoint for the
 * other without changing UI code.
 *
 * Note: imported lazily to avoid any chance of a circular import via the
 * slot service (which doesn't import appointments today, but might one
 * day need to reuse helpers).
 */
export async function getBookableSlots(rangeInput) {
  requireReadAccess();
  const clinicId = requireClinicId();
  const { computeSlots } = await import("./slot.service.js");

  // computeSlots performs its own validation (date format, window size,
  // doctorId shape) and tenant gating. Run it first so a bad input fails
  // fast before we hit the appointments collection.
  const base = await computeSlots(rangeInput.doctorId, {
    from: rangeInput.from,
    to: rangeInput.to,
  });

  // Compute the UTC window covered by the result. base.days is sorted
  // ascending and inclusive on both ends.
  if (base.days.length === 0) return base;

  // Fetch every active appointment for this doctor that overlaps the
  // window. The window ends at end-of-last-day in clinic-local time, but
  // it's enough to use a wide range and let the slot-by-slot overlap
  // check do the precision work.
  const timeZone = base.timezone;
  const lastDay = base.days[base.days.length - 1].date;
  const [fy, fm, fd] = base.days[0].date.split("-").map((s) => parseInt(s, 10));
  const [ly, lm, ld] = lastDay.split("-").map((s) => parseInt(s, 10));
  const windowStartUTC = localMidnightToUTC(timeZone, fy, fm, fd);
  const dayAfterLast = new Date(Date.UTC(ly, lm - 1, ld + 1));
  const windowEndUTC = localMidnightToUTC(
    timeZone,
    dayAfterLast.getUTCFullYear(),
    dayAfterLast.getUTCMonth() + 1,
    dayAfterLast.getUTCDate(),
  );

  // doctorId is already validated by computeSlots above.
  const appointments = await ClinicAppointment.find({
    doctorId: rangeInput.doctorId,
    status: { $in: [...ACTIVE_STATUSES] },
    startUTC: { $lt: windowEndUTC },
    endUTC: { $gt: windowStartUTC },
  })
    .select("startUTC endUTC")
    .lean();

  if (appointments.length === 0) return base;

  // For fast lookup: pre-compute each appointment's [start, end) as UTC
  // millis. Then for each slot, build its [slotStartMs, slotEndMs) the
  // same way and reject if it overlaps any.
  const taken = appointments.map((a) => [
    a.startUTC.getTime(),
    a.endUTC.getTime(),
  ]);

  const slotDurationMs = base.slotDurationMinutes * 60 * 1000;

  const filteredDays = base.days.map((day) => {
    const filteredSlots = day.slots.filter((slot) => {
      const slotStartMs = new Date(slot.startUTC).getTime();
      const slotEndMs = slotStartMs + slotDurationMs;
      for (const [tStart, tEnd] of taken) {
        // overlap rule: A starts before B ends AND A ends after B starts
        if (slotStartMs < tEnd && slotEndMs > tStart) return false;
      }
      return true;
    });
    return { date: day.date, slots: filteredSlots };
  });

  return {
    ...base,
    days: filteredDays,
  };
}

// Exported for unit tests / future composition.
export {
  ALLOWED_TRANSITIONS,
  deriveLocalCoords,
  assertNoConflict,
  toDTO as toAppointmentDTO,
};

export default {
  createAppointment,
  getAppointment,
  listAppointments,
  rescheduleAppointment,
  updateAppointmentReason,
  changeAppointmentStatus,
  getBookableSlots,
};
