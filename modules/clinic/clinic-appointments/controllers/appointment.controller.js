// server/modules/clinic/clinic-appointments/controllers/appointment.controller.js
//
// HTTP controllers for ClinicAppointment. Thin layer — same pattern as the
// other controllers in this module:
//   1. Validate input (delegates to validator → throws ValidationError)
//   2. Call the service
//   3. Shape response, push errors to next()
//
// Helper `parse(schema, source, label)` matches the convention used in
// the day-1/day-2 controllers (and patient.controller.js). It just decorates
// the validator's error with a label for easier debugging.
//
// One extra concern here: for the CREATE flow, the audit middleware needs
// to record `resourceId` (the new appointment's id) but that id doesn't
// exist until AFTER the service runs. The controller therefore stashes the
// id on `res.locals.createdAppointmentId` so the route's
// `resourceIdFrom` resolver can pick it up.

import {
  createAppointment,
  getAppointment,
  listAppointments,
  rescheduleAppointment,
  updateAppointmentReason,
  changeAppointmentStatus,
  getBookableSlots,
} from "../services/appointment.service.js";
import {
  validateCreateAppointment,
  validateRescheduleAppointment,
  validateStatusChange,
  validateListAppointments,
  validateFreeSlotsQuery,
} from "../validators/appointment.validator.js";
import { ValidationError } from "../../../../common/utils/errors.js";

// ─── Validator wrapper ────────────────────────────────────────
function parse(validatorFn, source, label) {
  try {
    return validatorFn(source);
  } catch (err) {
    if (err instanceof ValidationError && label) {
      err.message = `[${label}] ${err.message}`;
    }
    throw err;
  }
}

// ─── POST /appointments ───────────────────────────────────────
//  Body: { doctorId, patientId, startUTC, endUTC, reason? }
//  201   { appointment: {...} }
export async function createAppointmentController(req, res, next) {
  try {
    const input = parse(validateCreateAppointment, req.body, "create");
    const appointment = await createAppointment(input);
    // For the audit middleware (resourceIdFrom reads res.locals)
    res.locals.createdAppointmentId = appointment.id;
    res.status(201).json({ appointment });
  } catch (err) {
    next(err);
  }
}

// ─── GET /appointments ────────────────────────────────────────
//  Two modes (validator enforces):
//   ?doctorId=&from=YYYY-MM-DD&to=YYYY-MM-DD[&status=]
//   ?patientId=[&before=ISO][&limit=N][&status=]
//  200 { items: [...], count, nextBefore? }
export async function listAppointmentsController(req, res, next) {
  try {
    const query = parse(validateListAppointments, req.query, "list");
    const result = await listAppointments(query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// ─── GET /appointments/slots-free ─────────────────────────────
//  Bookable slots = doctor's schedule MINUS active appointments.
//  Same response shape as the day-3 /slots endpoint.
//  ?doctorId=&from=YYYY-MM-DD&to=YYYY-MM-DD
//  200 { doctorId, slotDurationMinutes, bufferMinutes, timezone, days: [...] }
export async function getSlotsFreeController(req, res, next) {
  try {
    const query = parse(validateFreeSlotsQuery, req.query, "slots-free");
    const result = await getBookableSlots(query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// ─── GET /appointments/:id ────────────────────────────────────
//  200 { appointment: {...} }
//  404 if not found / not in this clinic
export async function getAppointmentController(req, res, next) {
  try {
    const appointment = await getAppointment(req.params.id);
    res.status(200).json({ appointment });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /appointments/:id/reschedule ───────────────────────
//  Body: { startUTC, endUTC, reason? }
//  200 { appointment: {...} }
//  409 if the new time conflicts with another appointment, or if the
//      appointment is in a terminal status (completed/cancelled/no_show)
export async function rescheduleController(req, res, next) {
  try {
    const input = parse(validateRescheduleAppointment, req.body, "reschedule");
    const appointment = await rescheduleAppointment(req.params.id, input);
    res.status(200).json({ appointment });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /appointments/:id/reason ───────────────────────────
//  Body: { reason: string|null }
//  200 { appointment: {...} }
//  Edits the appointment's reason/notes regardless of current status —
//  used to correct typos or add notes after the fact. Does NOT change
//  timing or lifecycle state.
export async function updateReasonController(req, res, next) {
  try {
    // Light shape check; the service already does length validation.
    if (!req.body || typeof req.body !== "object") {
      throw new ValidationError("[reason] body must be an object");
    }
    const appointment = await updateAppointmentReason(req.params.id, {
      reason: req.body.reason,
    });
    res.status(200).json({ appointment });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /appointments/:id/status ───────────────────────────
//  Body: { status, cancelReason? }
//    status ∈ checked_in | completed | cancelled | no_show
//    cancelReason allowed only when status === "cancelled"
//  200 { appointment: {...} }
//  409 if the transition is illegal (e.g. completed → anything)
//  403 if the actor's role / ownership doesn't permit the change
export async function changeStatusController(req, res, next) {
  try {
    const input = parse(validateStatusChange, req.body, "status");
    const appointment = await changeAppointmentStatus(req.params.id, input);
    res.status(200).json({ appointment });
  } catch (err) {
    next(err);
  }
}

export default {
  createAppointmentController,
  listAppointmentsController,
  getSlotsFreeController,
  getAppointmentController,
  rescheduleController,
  updateReasonController,
  changeStatusController,
};
