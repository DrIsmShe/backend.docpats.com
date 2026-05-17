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
// AUDIT — special case for createAppointmentController:
//   All other appointment endpoints use auditMiddleware (see
//   appointment.routes.js). createAppointmentController is the
//   exception: the new appointment._id is only known AFTER
//   service.createAppointment() resolves, so we cannot use middleware's
//   resourceIdFrom (it would fire with resourceId=null and trigger the
//   strict invariant in audit.service.js, polluting prod logs with the
//   warning "[audit] async recordAction failed: resourceId is required
//   for action clinic.appointment.create").
//
//   A previous attempt used res.locals.createdAppointmentId + a
//   (req,res)=>... callback in resourceIdFrom, but auditMiddleware's
//   resolveValue only passes `req` to function-style sources, so `res`
//   was always undefined. That approach silently fell through to null.
//
//   This pattern mirrors clinic.patient.create + clinic.staff.* fixes
//   (commits 6a5be8b6 + e05c6465 on prod): direct call to
//   auditService.recordActionAsync after the operation, with actor +
//   context extracted from req using the same logic as auditMiddleware.
//   On failure (caught error) we record outcome="failure" so denied/
//   broken create attempts are visible in audit log.

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
import auditService from "../../../audit/services/audit.service.js";

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

/* ═══════════ AUDIT HELPERS ═══════════
   Mirror the extraction logic from auditMiddleware.js. Kept inline
   (not imported) because auditMiddleware doesn't export these helpers —
   they're internal there. Duplication is intentional and small.
   Same helpers as patient.controller.js — if middleware's extractors
   evolve, update in all three places (patient, appointment, staff).
*/

function extractActor(req) {
  if (req.actor?.userId) return req.actor;

  if (req.user) {
    const userId =
      req.user._id?.toString?.() ||
      req.user.userId?.toString?.() ||
      req.userId?.toString?.();

    if (userId) {
      return {
        userId,
        email: req.user.email || req.session?.email || null,
        role: req.user.role || req.session?.role || null,
      };
    }
  }

  if (req.session?.userId) {
    return {
      userId: String(req.session.userId),
      email:
        req.session.email || req.session.userEmail || req.user?.email || null,
      role: req.session.role || req.session.userRole || null,
    };
  }

  if (req.session?.employeeId) {
    return {
      userId: String(req.session.employeeId),
      email: req.session.employeeEmail || null,
      role: req.session.employeeRole || null,
    };
  }

  return null;
}

function extractContext(req, statusCode) {
  if (req.context) {
    return {
      ...req.context,
      httpMethod: req.method,
      httpPath: req.originalUrl || req.url,
      statusCode,
    };
  }

  return {
    ipAddress:
      req.ip ||
      req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.connection?.remoteAddress ||
      null,
    userAgent: req.headers?.["user-agent"] || null,
    sessionId: req.sessionID || null,
    requestId: req.id || null,
    httpMethod: req.method,
    httpPath: req.originalUrl || req.url,
    statusCode,
  };
}

// ─── POST /appointments ───────────────────────────────────────
//  Body: { doctorId, patientId, startUTC, endUTC, reason? }
//  201   { appointment: {...} }
//
// Audit is recorded HERE, not via middleware — see file header comment.
// We capture the real appointment._id as resourceId, satisfying the
// strict invariant in audit.service.js for create actions.
//
// res.locals.createdAppointmentId is still set for backward compatibility
// — in case any other middleware downstream reads it. It's no longer the
// audit source.
//
// PHI safety — metadata: only structural flags (hasReason, ids, timing).
// NEVER decrypted reason text, names, phones, emails.
export async function createAppointmentController(req, res, next) {
  const actor = extractActor(req);
  // Collected before try so failure-path audit also sees it.
  const baseMetadata = {
    doctorId: req.body?.doctorId ?? null,
    patientId: req.body?.patientId ?? null,
    hasReason: Boolean(req.body?.reason),
    startUTC: req.body?.startUTC ?? null,
    endUTC: req.body?.endUTC ?? null,
  };

  try {
    const input = parse(validateCreateAppointment, req.body, "create");
    const appointment = await createAppointment(input);

    // Kept for backward compat with any other downstream consumer.
    res.locals.createdAppointmentId = appointment.id;

    // Audit AFTER successful creation — resourceId is real now.
    if (actor) {
      auditService.recordActionAsync({
        actor,
        action: "clinic.appointment.create",
        resourceType: "clinic-appointment",
        resourceId: String(appointment.id),
        outcome: "success",
        metadata: baseMetadata,
        context: extractContext(req, 201),
      });
    }

    res.status(201).json({ appointment });
  } catch (err) {
    // Record the failed attempt. resourceId is null because the
    // appointment was never created. recordActionAsync internally
    // swallows the strict-invariant warning by virtue of being
    // fire-and-forget; we also wrap defensively in try/catch so the
    // primary next(err) never breaks because of audit issues.
    if (actor) {
      try {
        auditService.recordActionAsync({
          actor,
          action: "clinic.appointment.create",
          resourceType: "clinic-appointment",
          resourceId: null,
          outcome: "failure",
          failureReason: err?.message?.slice(0, 500) || "unknown",
          metadata: baseMetadata,
          context: extractContext(req, err?.statusCode || 500),
        });
      } catch (auditErr) {
        console.warn(
          "[audit] appointment.create failure record failed:",
          auditErr.message,
        );
      }
    }
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
