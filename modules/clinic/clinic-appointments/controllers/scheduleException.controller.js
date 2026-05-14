// server/modules/clinic/clinic-appointments/controllers/scheduleException.controller.js
//
// HTTP controllers for the schedule-exception sub-resource (per-date
// overrides of a doctor's weekly pattern: day-off / custom hours).
//
// Same thin-controller pattern as doctorSchedule.controller.js:
//   - parse/validate input via the validator, call the service, shape the
//     response. No business logic here.
//   - any thrown error → next(err); the global errorHandler renders the
//     correct HTTP status from ValidationError/NotFoundError/ForbiddenError.
//   - hand the service the VALIDATED/normalized payload, never raw req.body.
//
// Tenant + actor context is already on the request (tenantMiddleware
// upstream); the service reads it from tenantContext.

import {
  createException,
  bulkCreateDayOff,
  listExceptions,
  deleteException,
} from "../services/scheduleException.service.js";

import {
  validateCreateException,
  validateBulkDayOff,
  validateDateRangeQuery,
} from "../validators/scheduleException.validator.js";

/**
 * POST /appointments/exceptions/:doctorId
 *
 * Create (or replace) one schedule exception for one date.
 * Body: { date: "YYYY-MM-DD", type: "day_off"|"custom", intervals?, note? }
 *
 * 201 → { exception }
 * 400 → validation error (bad date, bad intervals, type/intervals mismatch)
 * 403 → no clinic/actor context
 * 404 → doctorId is not an active doctor of this clinic
 */
export async function postException(req, res, next) {
  try {
    const { doctorId } = req.params;
    const payload = validateCreateException(req.body);
    const exception = await createException(doctorId, payload);
    res.status(201).json({ exception });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /appointments/exceptions/:doctorId/bulk-day-off
 *
 * Mark an inclusive date range as day-off (vacation). Expanded into one
 * "day_off" exception per calendar day. Idempotent per day.
 * Body: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", note? }
 *
 * 201 → { created: <count>, days: ["YYYY-MM-DD", ...] }
 * 400 → validation error (bad range, range too large)
 * 403 → no clinic/actor context
 * 404 → doctorId is not an active doctor of this clinic
 */
export async function postBulkDayOff(req, res, next) {
  try {
    const { doctorId } = req.params;
    const payload = validateBulkDayOff(req.body);
    const result = await bulkCreateDayOff(doctorId, payload);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /appointments/exceptions/:doctorId?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * List all exceptions for one doctor within an inclusive date window.
 * Both `from` and `to` query params are required.
 *
 * 200 → { exceptions: [...], count }
 * 400 → missing/invalid from/to
 * 403 → no clinic context
 */
export async function getExceptions(req, res, next) {
  try {
    const { doctorId } = req.params;
    const range = validateDateRangeQuery(req.query);
    const exceptions = await listExceptions(doctorId, range);
    res.status(200).json({ exceptions, count: exceptions.length });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /appointments/exceptions/entry/:exceptionId
 *
 * Delete one exception by its own id (soft-delete via plugin).
 * Tenant-scoped: cannot delete another clinic's exception even with a
 * valid id.
 *
 * Note the path shape: "/exceptions/entry/:exceptionId" — deliberately
 * NOT "/exceptions/:exceptionId", to avoid colliding with
 * "/exceptions/:doctorId" (GET/POST). The :doctorId routes and the
 * :exceptionId route are different resources; the "entry" segment
 * disambiguates them cleanly.
 *
 * 200 → { deleted: true, id }
 * 400 → exceptionId is not a valid id
 * 403 → no clinic/actor context
 * 404 → no such exception in this clinic
 */
export async function deleteExceptionEntry(req, res, next) {
  try {
    const { exceptionId } = req.params;
    const result = await deleteException(exceptionId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export default {
  postException,
  postBulkDayOff,
  getExceptions,
  deleteExceptionEntry,
};
