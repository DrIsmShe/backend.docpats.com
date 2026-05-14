// server/modules/clinic/clinic-appointments/controllers/doctorSchedule.controller.js
//
// HTTP controllers for the doctor-schedule sub-resource of the clinic
// appointments module.
//
// Pattern (same as clinic-patients):
//   - Each handler is thin: parse/validate input, call the service, shape
//     the response. No business logic here.
//   - On any thrown error we call next(err) — the global errorHandler
//     middleware turns ValidationError/NotFoundError/ForbiddenError into the
//     right HTTP status + JSON body.
//   - The validated/normalized payload from validateUpsertSchedule() is what
//     we hand to the service — never the raw req.body.
//
// Tenant + actor context is already on the request (set by tenantMiddleware
// upstream); the service reads it from tenantContext, so controllers don't
// pass clinicId/userId explicitly.

import {
  upsertSchedule,
  getScheduleByDoctor,
  listSchedules,
} from "../services/staffSchedule.service.js";
import { validateUpsertSchedule } from "../validators/doctorSchedule.validator.js";

/**
 * PUT /appointments/schedule/:doctorId
 *
 * Create-or-replace the weekly working schedule for one doctor in the
 * current clinic. Idempotent.
 *
 * Body: { weeklyHours, slotDurationMinutes?, bufferMinutes?, isActive? }
 * (see doctorSchedule.validator.js for the exact shape)
 *
 * 200 → { schedule }
 * 400 → validation error (bad intervals, overlaps, etc.)
 * 403 → no clinic/actor context
 * 404 → doctorId is not an active doctor of this clinic
 */
export async function putDoctorSchedule(req, res, next) {
  try {
    const { doctorId } = req.params;

    // Throws ValidationError (→ 400) on any structural/semantic problem.
    // Returns a clean, normalized payload.
    const payload = validateUpsertSchedule(req.body);

    const schedule = await upsertSchedule(doctorId, payload);

    res.status(200).json({ schedule });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /appointments/schedule/:doctorId
 *
 * Fetch one doctor's weekly schedule in the current clinic.
 * Returns { schedule: null } (still 200) when the doctor has no schedule
 * configured yet — absence is a normal state, not an error.
 *
 * 200 → { schedule } | { schedule: null }
 * 400 → doctorId is not a valid id
 * 403 → no clinic context
 */
export async function getDoctorSchedule(req, res, next) {
  try {
    const { doctorId } = req.params;
    const schedule = await getScheduleByDoctor(doctorId);
    res.status(200).json({ schedule });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /appointments/schedule
 *
 * List every doctor schedule in the current clinic (admin overview).
 * Optional query: ?activeOnly=true → only schedules with isActive: true.
 *
 * 200 → { schedules: [...], count }
 * 403 → no clinic context
 */
export async function listDoctorSchedules(req, res, next) {
  try {
    const activeOnly =
      req.query.activeOnly === "true" || req.query.activeOnly === "1";
    const schedules = await listSchedules({ activeOnly });
    res.status(200).json({ schedules, count: schedules.length });
  } catch (err) {
    next(err);
  }
}

export default {
  putDoctorSchedule,
  getDoctorSchedule,
  listDoctorSchedules,
};
