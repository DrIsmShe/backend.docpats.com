// server/modules/clinic/clinic-analytics/services/analytics.service.js
//
// Read-only analytics aggregation for a single clinic (tenant).
//
// Design notes:
//   • This service is PURE with respect to auth: it takes `clinicId` as an
//     explicit argument. The controller resolves it from the tenant context
//     (getCurrentClinicId()) and passes it in. That keeps the service unit-
//     testable and makes the tenant boundary obvious at the call site.
//
//   • CRITICAL: Mongoose aggregation pipelines BYPASS the query middleware
//     added by tenantScopedPlugin and softDeletePlugin. Those plugins only
//     patch find/count-style hooks — never `.aggregate()`. So every pipeline
//     here MUST include, in its first `$match`, both:
//         clinicId: <ObjectId>
//         isDeleted: { $ne: true }
//     Forgetting either one leaks data across clinics or counts deleted rows.
//
//   • Statuses are imported from the model's frozen enum, never hardcoded,
//     so a future status change can't silently desync the analytics buckets.
//
//   • Financial metrics (revenue, etc.) are intentionally NOT here. They live
//     behind RESOURCES.ANALYTICS_FINANCE, which the manager role does not have.
//     This module only touches operational counts.

import mongoose from "mongoose";

import ClinicAppointment, {
  APPOINTMENT_STATUSES,
} from "../../clinic-appointments/models/clinicAppointment.model.js";
import ClinicPatient from "../../clinic-patients/models/clinicPatient.model.js";

// ─── Date range presets ───────────────────────────────────────
//
// Each preset resolves to a lower bound (`from`) measured back from "now".
// `all` has no lower bound. There is no upper bound — analytics always runs
// up to the present moment. Using calendar-agnostic "now minus N" avoids the
// timezone edge cases we hit with localDate string math.

const DAY_MS = 24 * 60 * 60 * 1000;

export const RANGE_PRESETS = Object.freeze({
  day: 1 * DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  half_year: 182 * DAY_MS,
  year: 365 * DAY_MS,
  three_years: 3 * 365 * DAY_MS,
  five_years: 5 * 365 * DAY_MS,
  all: null, // no lower bound
});

export const DEFAULT_RANGE = "month";

/**
 * Resolve a preset key into a { from, to } window.
 * Unknown keys fall back to DEFAULT_RANGE rather than throwing, so a stale
 * client can't 500 the endpoint.
 *
 * @param {string} range  one of RANGE_PRESETS keys
 * @returns {{ from: Date|null, to: Date, key: string }}
 */
export function resolveRange(range) {
  const key = Object.prototype.hasOwnProperty.call(RANGE_PRESETS, range)
    ? range
    : DEFAULT_RANGE;

  const to = new Date();
  const span = RANGE_PRESETS[key];
  const from = span === null ? null : new Date(to.getTime() - span);

  return { from, to, key };
}

// ─── Internal helpers ─────────────────────────────────────────

/**
 * Build the base $match stage shared by every appointment pipeline.
 * Always enforces tenant scope + soft-delete exclusion (see file header).
 * The date window is applied on startUTC (the canonical appointment time).
 */
function appointmentMatch(clinicOid, from, to) {
  const match = {
    clinicId: clinicOid,
    isDeleted: { $ne: true },
  };

  // startUTC window. `from` null => open-ended (the `all` preset).
  const startUTC = {};
  if (from) startUTC.$gte = from;
  if (to) startUTC.$lte = to;
  if (Object.keys(startUTC).length > 0) {
    match.startUTC = startUTC;
  }

  return match;
}

/**
 * Zero-fill a status→count map so the client always gets every bucket,
 * even statuses that had no appointments in the window.
 */
function emptyStatusBuckets() {
  const out = {};
  for (const s of APPOINTMENT_STATUSES) out[s] = 0;
  return out;
}

// ─── Metric 1: appointments by status ─────────────────────────

async function appointmentsByStatus(clinicOid, from, to) {
  const rows = await ClinicAppointment.aggregate([
    { $match: appointmentMatch(clinicOid, from, to) },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const buckets = emptyStatusBuckets();
  let total = 0;
  for (const r of rows) {
    // Guard against any legacy status not in the current enum.
    if (Object.prototype.hasOwnProperty.call(buckets, r._id)) {
      buckets[r._id] = r.count;
    }
    total += r.count;
  }

  return { total, byStatus: buckets };
}

// ─── Metric 2: no-show rate ───────────────────────────────────
//
// no-show rate = no_show / (completed + no_show)
// i.e. of the appointments that reached a terminal "did the patient turn up"
// state, what fraction were no-shows. Scheduled/checked_in/cancelled are
// excluded from the denominator because they don't answer that question.

async function noShowRate(clinicOid, from, to) {
  const hasNoShow = APPOINTMENT_STATUSES.includes("no_show");
  const hasCompleted = APPOINTMENT_STATUSES.includes("completed");

  // If the enum doesn't have these (shouldn't happen), return a null rate
  // rather than dividing by zero.
  if (!hasNoShow || !hasCompleted) {
    return { rate: null, noShow: 0, completed: 0, denominator: 0 };
  }

  const rows = await ClinicAppointment.aggregate([
    {
      $match: {
        ...appointmentMatch(clinicOid, from, to),
        status: { $in: ["no_show", "completed"] },
      },
    },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  let noShow = 0;
  let completed = 0;
  for (const r of rows) {
    if (r._id === "no_show") noShow = r.count;
    else if (r._id === "completed") completed = r.count;
  }

  const denominator = noShow + completed;
  const rate = denominator === 0 ? null : noShow / denominator;

  return { rate, noShow, completed, denominator };
}

// ─── Metric 3: doctor load distribution ───────────────────────
//
// Appointments per doctor in the window. Returns doctorId + count, sorted
// desc. Name resolution is left to the frontend (variant B): the service
// stays free of the User model to avoid a cross-module dependency here;
// the DTO carries raw doctorId strings and the client maps them against the
// clinic's already-loaded doctor/staff list.

async function doctorLoad(clinicOid, from, to) {
  const rows = await ClinicAppointment.aggregate([
    { $match: appointmentMatch(clinicOid, from, to) },
    { $group: { _id: "$doctorId", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  return rows.map((r) => ({
    doctorId: r._id ? String(r._id) : null,
    count: r.count,
  }));
}

// ─── Metric 4: daily trend ────────────────────────────────────
//
// Appointment count per local calendar day. Groups on `localDate`
// ("YYYY-MM-DD" in clinic tz, denormalised on the doc), so the buckets match
// how the calendar UI thinks about days — no server-side tz conversion needed.
// Returns a sparse series (only days that had appointments); the frontend
// fills gaps for the chart.

async function dailyTrend(clinicOid, from, to) {
  const rows = await ClinicAppointment.aggregate([
    { $match: appointmentMatch(clinicOid, from, to) },
    { $group: { _id: "$localDate", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  return rows
    .filter((r) => typeof r._id === "string" && r._id.length > 0)
    .map((r) => ({ date: r._id, count: r.count }));
}

// ─── Metric 5: new patients ───────────────────────────────────
//
// ClinicPatient documents created within the window. Uses createdAt
// (timestamps:true on the schema, indexed by { clinicId, createdAt }).
// This model is NOT tenant/soft-delete plugin-managed the same way in
// aggregation either, so we match clinicId + isDeleted explicitly too, if
// the field exists; ClinicPatient may or may not carry isDeleted, so we
// guard with $ne which is a no-op when the field is absent.

async function newPatients(clinicOid, from, to) {
  const match = {
    clinicId: clinicOid,
    isDeleted: { $ne: true },
  };

  const createdAt = {};
  if (from) createdAt.$gte = from;
  if (to) createdAt.$lte = to;
  if (Object.keys(createdAt).length > 0) {
    match.createdAt = createdAt;
  }

  const rows = await ClinicPatient.aggregate([
    { $match: match },
    { $count: "count" },
  ]);

  return rows.length > 0 ? rows[0].count : 0;
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Compute the full v1 analytics overview for one clinic over one preset range.
 *
 * @param {object}  args
 * @param {string}  args.clinicId  required — the tenant to scope to
 * @param {string} [args.range]    preset key (see RANGE_PRESETS); default "month"
 * @returns {Promise<object>}      analytics DTO
 */
export async function getOverview({ clinicId, range } = {}) {
  if (!clinicId) {
    throw new Error("getOverview: clinicId is required");
  }
  if (!mongoose.isValidObjectId(clinicId)) {
    throw new Error("getOverview: clinicId is not a valid ObjectId");
  }

  const clinicOid = new mongoose.Types.ObjectId(String(clinicId));
  const { from, to, key } = resolveRange(range);

  // Run the five metrics concurrently — they're independent reads.
  const [status, noShow, load, trend, patients] = await Promise.all([
    appointmentsByStatus(clinicOid, from, to),
    noShowRate(clinicOid, from, to),
    doctorLoad(clinicOid, from, to),
    dailyTrend(clinicOid, from, to),
    newPatients(clinicOid, from, to),
  ]);

  return {
    range: {
      key,
      from: from ? from.toISOString() : null,
      to: to.toISOString(),
    },
    appointments: {
      total: status.total,
      byStatus: status.byStatus,
    },
    noShow, // { rate, noShow, completed, denominator }
    doctorLoad: load, // [{ doctorId, count }]
    dailyTrend: trend, // [{ date, count }]
    newPatients: patients, // number
    generatedAt: new Date().toISOString(),
  };
}

export default { getOverview, resolveRange, RANGE_PRESETS, DEFAULT_RANGE };