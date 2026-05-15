// server/modules/clinic/clinic-appointments/index.js
//
// Router for the clinic-appointments sub-module.
//
// This is the CLINIC appointments module — fully isolated from the legacy
// per-doctor `modules/appointments/` module:
//   - separate collections (clinic_doctor_schedules, clinic_schedule_exceptions,
//     clinic_appointments)
//   - separate models (ClinicDoctorSchedule, ClinicScheduleException,
//     ClinicAppointment)
//   - separate routes, mounted here under the clinic tenant umbrella
//
// Mounting chain:
//   server/index.js          app.use("/api/v1/clinic", clinicRoutes)
//   clinic/index.js          router.use("/appointments", clinicAppointmentsRouter)
//   THIS FILE                router.use("/", <each sub-router>)
//
//   ⇒ full path examples:
//      PUT   /api/v1/clinic/appointments/schedule/:doctorId
//      POST  /api/v1/clinic/appointments/exceptions/:doctorId
//      GET   /api/v1/clinic/appointments/slots?doctorId=&from=&to=
//      POST  /api/v1/clinic/appointments                  (NEW — day 4)
//      GET   /api/v1/clinic/appointments/slots-free?...   (NEW — day 4)
//      GET   /api/v1/clinic/appointments/:id              (NEW — day 4)
//      PATCH /api/v1/clinic/appointments/:id/status       (NEW — day 4)
//
// IMPORTANT — path prefix ownership:
//   Each sub-router declares its OWN path prefix internally
//   (doctorSchedule.routes.js owns "/schedule", scheduleException.routes.js
//   owns "/exceptions", slot.routes.js owns "/slots", appointment.routes.js
//   owns the root "/" + "/:id" + "/slots-free"). Therefore EVERY sub-router
//   is mounted on "/" here. Mounting on a prefix would double it and 404.
//   This aggregator only owns "/appointments" (applied one level up in
//   clinic/index.js).
//
//   Mount order DOES matter for the literal /slots vs /slots-free paths
//   and for the appointment root "/" vs the schedule/exception sub-paths.
//   Express tries each `router.use` in order and the first that has a
//   matching route handles the request. Schedule/exception/slots routes
//   only respond on their own literal prefixes, so they don't shadow the
//   appointment root — but we keep appointment routes LAST so a future
//   addition that overlaps gets the late-match guarantee.
//
// tenantMiddleware has already run in clinic/index.js by the time a request
// reaches here, so tenant + actor context is available to controllers and
// services via tenantContext.

import express from "express";

import doctorScheduleRoutes from "./routes/doctorSchedule.routes.js";
import scheduleExceptionRoutes from "./routes/scheduleException.routes.js";
import slotRoutes from "./routes/slot.routes.js";
import appointmentRoutes from "./routes/appointment.routes.js";

const router = express.Router();

// --- Doctor weekly schedules (day 1) ---------------------------------
// doctorScheduleRoutes internally owns "/schedule". Full paths:
//   PUT  /appointments/schedule/:doctorId   -> upsert weekly working hours
//   GET  /appointments/schedule/:doctorId   -> fetch one doctor's schedule
//   GET  /appointments/schedule             -> list all schedules in clinic
router.use("/", doctorScheduleRoutes);

// --- Per-date schedule exceptions (day 2) ----------------------------
// scheduleExceptionRoutes internally owns "/exceptions". Full paths:
//   POST   /appointments/exceptions/:doctorId               -> create one
//   POST   /appointments/exceptions/:doctorId/bulk-day-off  -> vacation range
//   GET    /appointments/exceptions/:doctorId?from=&to=     -> list in window
//   DELETE /appointments/exceptions/entry/:exceptionId      -> delete one
router.use("/", scheduleExceptionRoutes);

// --- Free-slot lookup (day 3, pure availability) ---------------------
// slotRoutes internally owns "/slots". Full path:
//   GET /appointments/slots?doctorId=&from=&to=
// Composes the weekly pattern + exceptions into concrete slots. Does NOT
// subtract booked appointments — that's what appointment.routes' /slots-free
// is for.
router.use("/", slotRoutes);

// --- Appointment CRUD + lifecycle + bookable slots (day 4) -----------
// appointmentRoutes internally owns "/", "/:id" and "/slots-free". Full paths:
//   POST    /appointments                  -> create
//   GET     /appointments                  -> list (doctor or patient mode)
//   GET     /appointments/slots-free       -> slots minus active appointments
//   GET     /appointments/:id              -> fetch one
//   PATCH   /appointments/:id/reschedule   -> move time
//   PATCH   /appointments/:id/reason       -> edit notes (any status)
//   PATCH   /appointments/:id/status       -> lifecycle FSM transition
router.use("/", appointmentRoutes);

export default router;
