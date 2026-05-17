// server/modules/clinic/clinic-appointments/routes/appointment.routes.js
//
// Routes for the ClinicAppointment endpoints (Sprint 1, day 4).
//
// Mounted by clinic-appointments/index.js on "/" (each sub-router owns
// its own paths internally — see that file's header). The aggregator
// already sits on "/appointments" one level up in clinic/index.js, so
// the full URLs are:
//
//   POST    /api/v1/clinic/appointments
//   GET     /api/v1/clinic/appointments
//   GET     /api/v1/clinic/appointments/slots-free?...
//   GET     /api/v1/clinic/appointments/:id
//   PATCH   /api/v1/clinic/appointments/:id/reschedule
//   PATCH   /api/v1/clinic/appointments/:id/reason
//   PATCH   /api/v1/clinic/appointments/:id/status
//
// IMPORTANT — route ordering: Express matches in declaration order.
// /slots-free MUST be declared before /:id, otherwise the parameterized
// route eats "slots-free" as an id. The /:id/* sub-paths (reschedule,
// reason, status) are safe to declare AFTER /:id because their full
// paths don't collide with the bare /:id pattern.
//
// AUDIT: every endpoint records to hipaa_audit_logs. PHI safety —
// metaFrom callbacks NEVER include decrypted text (no reason, no
// cancelReason that came from req.body). Only structural metadata: ids,
// timing structure, status string, field names.
//
// resourceIdFrom: most routes can read from `params.id`.
//
// EXCEPTION — POST / (create appointment):
//   The new appointment's id doesn't exist until the service runs, so
//   resourceIdFrom can't capture it via middleware. Previous attempt
//   used res.locals.createdAppointmentId + a (req,res)=>... callback,
//   but auditMiddleware's resolveValue only passes `req` to functions,
//   so res was always undefined and resourceId stayed null in prod
//   audit log (see prod warning "[audit] async recordAction failed:
//   resourceId is required for action clinic.appointment.create").
//
//   Fix mirrors clinic.patient.create / clinic.staff.* approach
//   (commits 6a5be8b6 + e05c6465): auditMiddleware is NOT attached to
//   the create route. Instead, the controller calls recordActionAsync
//   directly AFTER service.createAppointment() returns, with the real
//   appointment._id as resourceId. Failure path also recorded so
//   denied/broken creates are visible in audit log.
//
//   See appointment.controller.js → createAppointmentController.

import express from "express";

import {
  createAppointmentController,
  listAppointmentsController,
  getSlotsFreeController,
  getAppointmentController,
  rescheduleController,
  updateReasonController,
  changeStatusController,
} from "../controllers/appointment.controller.js";
import { auditMiddleware } from "../../../audit/middleware/auditMiddleware.js";

const router = express.Router();

// ─── Specific routes FIRST ────────────────────────────────────

// GET /appointments/slots-free — bookable slots (schedule minus active appts)
router.get(
  "/slots-free",
  auditMiddleware({
    resourceType: "clinic-doctor-schedule",
    action: "clinic.appointment.slots_free.view",
    resourceIdFrom: (req) => req.query?.doctorId || null,
    metaFrom: (req) => ({
      doctorId: req.query?.doctorId ?? null,
      from: req.query?.from ?? null,
      to: req.query?.to ?? null,
    }),
  }),
  getSlotsFreeController,
);

// ─── CRUD root ────────────────────────────────────────────────

// POST /appointments — create.
// NO auditMiddleware here — see header comment. Audit is recorded
// inside controllers/appointment.controller.js → createAppointmentController
// AFTER the service generates the appointment._id, so resourceId is
// real instead of null. This closes the prod warning
// "[audit] async recordAction failed: resourceId is required for
// action clinic.appointment.create".
router.post("/", createAppointmentController);

// GET /appointments — list (doctor mode OR patient mode)
router.get(
  "/",
  auditMiddleware({
    resourceType: "clinic-appointment",
    action: "clinic.appointment.list",
    metaFrom: (req) => ({
      mode: req.query?.doctorId ? "doctor" : "patient",
      doctorId: req.query?.doctorId ?? null,
      patientId: req.query?.patientId ?? null,
      from: req.query?.from ?? null,
      to: req.query?.to ?? null,
      status: req.query?.status ?? null,
    }),
  }),
  listAppointmentsController,
);

// ─── Parameterized routes ─────────────────────────────────────

// GET /appointments/:id — fetch one
router.get(
  "/:id",
  auditMiddleware({
    resourceType: "clinic-appointment",
    action: "clinic.appointment.view",
    resourceIdFrom: "params.id",
  }),
  getAppointmentController,
);

// PATCH /appointments/:id/reschedule — move time
router.patch(
  "/:id/reschedule",
  auditMiddleware({
    resourceType: "clinic-appointment",
    action: "clinic.appointment.reschedule",
    resourceIdFrom: "params.id",
    metaFrom: (req) => ({
      newStartUTC: req.body?.startUTC ?? null,
      newEndUTC: req.body?.endUTC ?? null,
      reasonChanged: Object.prototype.hasOwnProperty.call(
        req.body || {},
        "reason",
      ),
    }),
  }),
  rescheduleController,
);

// PATCH /appointments/:id/reason — edit reason/notes (any status)
router.patch(
  "/:id/reason",
  auditMiddleware({
    resourceType: "clinic-appointment",
    action: "clinic.appointment.update_reason",
    resourceIdFrom: "params.id",
    metaFrom: (req) => ({
      // PHI safety: NEVER include the actual reason text in audit metadata.
      // Only record whether it was cleared or not.
      reasonCleared:
        req.body?.reason === null ||
        req.body?.reason === undefined ||
        req.body?.reason === "",
    }),
  }),
  updateReasonController,
);

// PATCH /appointments/:id/status — lifecycle transition
router.patch(
  "/:id/status",
  auditMiddleware({
    resourceType: "clinic-appointment",
    action: "clinic.appointment.status_change",
    resourceIdFrom: "params.id",
    metaFrom: (req) => ({
      toStatus: req.body?.status ?? null,
      // cancelReason can carry operator commentary — keep it OUT of the
      // audit metadata; only record whether one was supplied.
      hasCancelReason: Boolean(req.body?.cancelReason),
    }),
  }),
  changeStatusController,
);

export default router;
