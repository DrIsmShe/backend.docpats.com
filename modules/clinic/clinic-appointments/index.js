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
//      PUT  /api/v1/clinic/appointments/schedule/:doctorId
//      POST /api/v1/clinic/appointments/exceptions/:doctorId
//
// IMPORTANT — path prefix ownership:
//   Each sub-router declares its OWN path prefix internally
//   (doctorSchedule.routes.js owns "/schedule", scheduleException.routes.js
//   owns "/exceptions"). Therefore EVERY sub-router is mounted on "/" here.
//   Mounting on a prefix would double it and 404. This aggregator only owns
//   "/appointments" (applied one level up in clinic/index.js).
//
// tenantMiddleware has already run in clinic/index.js by the time a request
// reaches here, so tenant + actor context is available to controllers and
// services via tenantContext. Nothing tenant-related is done in this file.
//
// As the module grows (Sprint 1 days 3-6) more sub-routers attach here,
// each owning its own prefix internally and mounted on "/".

import express from "express";

import doctorScheduleRoutes from "./routes/doctorSchedule.routes.js";
import scheduleExceptionRoutes from "./routes/scheduleException.routes.js";

const router = express.Router();

// --- Doctor weekly schedules -----------------------------------------
// doctorScheduleRoutes internally owns "/schedule". Full paths:
//   PUT  /appointments/schedule/:doctorId   -> upsert weekly working hours
//   GET  /appointments/schedule/:doctorId   -> fetch one doctor's schedule
//   GET  /appointments/schedule             -> list all schedules in clinic
router.use("/", doctorScheduleRoutes);

// --- Per-date schedule exceptions (day-off / custom hours) ------------
// scheduleExceptionRoutes internally owns "/exceptions". Full paths:
//   POST   /appointments/exceptions/:doctorId               -> create one
//   POST   /appointments/exceptions/:doctorId/bulk-day-off  -> vacation range
//   GET    /appointments/exceptions/:doctorId?from=&to=     -> list in window
//   DELETE /appointments/exceptions/entry/:exceptionId      -> delete one
router.use("/", scheduleExceptionRoutes);

// --- (Sprint 1, day 3+) Free-slot lookup -----------------------------
// slotsRoutes will own "/slots" internally -> mount on "/" here too.
// router.use("/", slotsRoutes);

// --- (Sprint 1, day 4+) Appointments CRUD + lifecycle ----------------
// appointmentRoutes will own "/appointments"-relative paths internally.
// router.use("/", appointmentRoutes);

export default router;
