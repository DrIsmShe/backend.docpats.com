// server/modules/clinic/clinic-appointments/controllers/slot.controller.js
//
// HTTP controller for the free-slot lookup endpoint.
//
// Thin layer, same pattern as the other controllers in this module:
// pull params, call the service, shape the response, push errors to next().
// The service does all validation (date format, window size, doctorId).

import { computeSlots } from "../services/slot.service.js";

/**
 * GET /appointments/slots?doctorId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Compute bookable slots for a doctor across a date window.
 *
 * Query params (all required):
 *   doctorId  — the doctor whose availability is being queried
 *   from      — inclusive window start, "YYYY-MM-DD"
 *   to        — inclusive window end,   "YYYY-MM-DD"
 *
 * 200 → {
 *   doctorId, slotDurationMinutes, bufferMinutes, timezone,
 *   days: [ { date: "YYYY-MM-DD", slots: [ {startMinute,endMinute,startUTC} ] } ]
 * }
 * 400 → bad/missing doctorId, bad date format, window too large, from > to
 * 403 → no clinic context
 * 404 → clinic not found
 *
 * NOTE: day 3 does not subtract booked appointments — every returned slot
 * means "the doctor works then", not "the doctor is free then".
 */
export async function getSlots(req, res, next) {
  try {
    const { doctorId, from, to } = req.query;
    const result = await computeSlots(doctorId, { from, to });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export default { getSlots };
