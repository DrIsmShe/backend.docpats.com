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
// resourceIdFrom: most routes can read from `params.id`. The CREATE
// route is special — the new appointment's id only exists after the
// controller runs, so the controller stashes it on
// `res.locals.createdAppointmentId` and the resolver picks it up there.

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

// POST /appointments — create
router.post(
  "/",
  auditMiddleware({
    resourceType: "clinic-appointment",
    action: "clinic.appointment.create",
    // The id doesn't exist on the request — the controller fills
    // res.locals.createdAppointmentId after the service runs.
    resourceIdFrom: (req, res) => res?.locals?.createdAppointmentId || null,
    metaFrom: (req) => ({
      doctorId: req.body?.doctorId ?? null,
      patientId: req.body?.patientId ?? null,
      hasReason: Boolean(req.body?.reason),
      // Timing is structural metadata, not PHI:
      startUTC: req.body?.startUTC ?? null,
      endUTC: req.body?.endUTC ?? null,
    }),
  }),
  createAppointmentController,
);

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
