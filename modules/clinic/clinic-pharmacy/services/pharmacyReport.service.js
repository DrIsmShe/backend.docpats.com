// server/modules/clinic/clinic-pharmacy/services/pharmacyReport.service.js
//
// Period reports over the dispense journal (отчёты по выдаче за период).
// This is the ONE place in the pharmacy module that uses .aggregate().
//
// AGGREGATE DISCIPLINE (the recurring footgun):
//   • .aggregate() bypasses Mongoose plugins AND does not cast types.
//   • DispenseLog has NO softDeletePlugin (append-only), so there is no
//     isDeleted field — do NOT add it to $match.
//   • EVERY $match MUST include clinicId, cast to ObjectId explicitly
//     (a string clinicId will silently match nothing).
//
// Names for drug items / departments are fetched in a second query and merged
// in JS — simpler and safer than $lookup for these small result sets.

import mongoose from "mongoose";
import DispenseLog from "../models/dispenseLog.model.js";
import DrugItem from "../models/drugItem.model.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";

function httpError(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  if (code) err.code = code;
  return err;
}

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw httpError("No clinic context", 401, "NO_CLINIC_CONTEXT");
  return clinicId;
}

function toObjectId(id) {
  return new mongoose.Types.ObjectId(String(id));
}

// Base $match for every pipeline — clinicId (as ObjectId) + date window.
function baseMatch(clinicId, from, to, extra = {}) {
  return {
    clinicId: toObjectId(clinicId),
    dispensedAt: { $gte: from, $lt: to },
    ...extra,
  };
}

/**
 * Resolve a named period into a [from, to) window (to is exclusive).
 * @param {"day"|"week"|"month"|"quarter"|"year"} period
 * @param {Date|string} [ref]  reference date inside the period (default now)
 * @returns {{from: Date, to: Date, period: string, label: string}}
 */
export function resolvePeriod(period, ref) {
  const d = ref ? new Date(ref) : new Date();
  if (Number.isNaN(d.getTime())) throw httpError("invalid ref date", 400);

  let from;
  let to;

  switch (period) {
    case "day": {
      from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      to = new Date(from);
      to.setDate(to.getDate() + 1);
      break;
    }
    case "week": {
      // ISO week: Monday 00:00 → next Monday.
      const day = (d.getDay() + 6) % 7; // 0 = Monday
      from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
      to = new Date(from);
      to.setDate(to.getDate() + 7);
      break;
    }
    case "month": {
      from = new Date(d.getFullYear(), d.getMonth(), 1);
      to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      break;
    }
    case "quarter": {
      const q = Math.floor(d.getMonth() / 3);
      from = new Date(d.getFullYear(), q * 3, 1);
      to = new Date(d.getFullYear(), q * 3 + 3, 1);
      break;
    }
    case "year": {
      from = new Date(d.getFullYear(), 0, 1);
      to = new Date(d.getFullYear() + 1, 0, 1);
      break;
    }
    default:
      throw httpError("invalid period", 400, "BAD_PERIOD");
  }

  return {
    from,
    to,
    period,
    label: `${from.toISOString()}..${to.toISOString()}`,
  };
}

// Merge names into [{ _id, qty, events }] rows fetched by grouping.
async function attachDrugNames(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r._id).filter(Boolean);
  const drugs = await DrugItem.find({ _id: { $in: ids } })
    .select("name form strength baseUnit isControlled")
    .lean();
  const byId = new Map(drugs.map((d) => [String(d._id), d]));
  return rows.map((r) => {
    const drug = byId.get(String(r._id)) || {};
    return {
      drugItemId: String(r._id),
      name: drug.name || "—",
      form: drug.form || null,
      strength: drug.strength || null,
      baseUnit: drug.baseUnit || null,
      isControlled: !!drug.isControlled,
      qty: r.qty,
      events: r.events,
    };
  });
}

/**
 * Full period summary for the leadership report.
 *
 * @param {object} args
 * @param {Date} args.from   inclusive
 * @param {Date} args.to     exclusive
 * @param {number} [args.topDrugsLimit=20]
 * @returns {Promise<object>}
 */
export async function getPeriodSummary({ from, to, topDrugsLimit = 20 }) {
  const clinicId = requireClinicId();
  if (!(from instanceof Date) || !(to instanceof Date)) {
    throw httpError("from/to Date required", 400);
  }

  const match = baseMatch(clinicId, from, to);
  const controlledMatch = baseMatch(clinicId, from, to, { isControlled: true });

  const [
    totalsAgg,
    byTargetAgg,
    byDrugAgg,
    byDeptAgg,
    controlledTotalsAgg,
    controlledByDrugAgg,
  ] = await Promise.all([
    // A) headline totals
    DispenseLog.aggregate([
      { $match: match },
      { $group: { _id: null, qty: { $sum: "$qty" }, events: { $sum: 1 } } },
    ]),
    // B) by channel
    DispenseLog.aggregate([
      { $match: match },
      {
        $group: { _id: "$target", qty: { $sum: "$qty" }, events: { $sum: 1 } },
      },
    ]),
    // C) top drugs
    DispenseLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$drugItemId",
          qty: { $sum: "$qty" },
          events: { $sum: 1 },
        },
      },
      { $sort: { qty: -1 } },
      { $limit: Math.min(Math.max(Number(topDrugsLimit) || 20, 1), 200) },
    ]),
    // D) by department (only rows that have a department)
    DispenseLog.aggregate([
      {
        $match: baseMatch(clinicId, from, to, { departmentId: { $ne: null } }),
      },
      {
        $group: {
          _id: "$departmentId",
          qty: { $sum: "$qty" },
          events: { $sum: 1 },
        },
      },
      { $sort: { qty: -1 } },
    ]),
    // E) controlled totals (ПКУ)
    DispenseLog.aggregate([
      { $match: controlledMatch },
      { $group: { _id: null, qty: { $sum: "$qty" }, events: { $sum: 1 } } },
    ]),
    // F) controlled by drug
    DispenseLog.aggregate([
      { $match: controlledMatch },
      {
        $group: {
          _id: "$drugItemId",
          qty: { $sum: "$qty" },
          events: { $sum: 1 },
        },
      },
      { $sort: { qty: -1 } },
    ]),
  ]);

  // by-target → object keyed by channel
  const byTarget = { requisition: null, patient: null, department: null };
  for (const row of byTargetAgg) {
    byTarget[row._id] = { qty: row.qty, events: row.events };
  }

  // department names (second query + merge)
  const deptIds = byDeptAgg.map((r) => r._id).filter(Boolean);
  let deptNames = new Map();
  if (deptIds.length) {
    // Department model name may differ — resolve loosely via the shared conn.
    // We only need names; if the model isn't registered, fall back to ids.
    try {
      const Department =
        mongoose.models.Department || mongoose.model("Department");
      const depts = await Department.find({ _id: { $in: deptIds } })
        .select("name")
        .lean();
      deptNames = new Map(depts.map((x) => [String(x._id), x.name]));
    } catch {
      deptNames = new Map();
    }
  }

  const totals = totalsAgg[0] || { qty: 0, events: 0 };
  const controlledTotals = controlledTotalsAgg[0] || { qty: 0, events: 0 };

  return {
    range: { from, to },
    totals: { qty: totals.qty || 0, events: totals.events || 0 },
    byTarget,
    byDepartment: byDeptAgg.map((r) => ({
      departmentId: String(r._id),
      name: deptNames.get(String(r._id)) || "—",
      qty: r.qty,
      events: r.events,
    })),
    topDrugs: await attachDrugNames(byDrugAgg),
    controlled: {
      totals: {
        qty: controlledTotals.qty || 0,
        events: controlledTotals.events || 0,
      },
      byDrug: await attachDrugNames(controlledByDrugAgg),
    },
  };
}

/**
 * Time-series of dispensed quantity, bucketed for charts.
 *
 * @param {object} args
 * @param {Date} args.from
 * @param {Date} args.to
 * @param {"day"|"week"|"month"} [args.bucket="day"]
 * @param {string} [args.timezone]  IANA tz (e.g. clinic.timezone); default UTC
 * @returns {Promise<Array<{bucket: Date, qty: number, events: number}>>}
 */
export async function getTimeSeries({ from, to, bucket = "day", timezone }) {
  const clinicId = requireClinicId();
  if (!(from instanceof Date) || !(to instanceof Date)) {
    throw httpError("from/to Date required", 400);
  }
  const unit = ["day", "week", "month"].includes(bucket) ? bucket : "day";

  const truncArg = { date: "$dispensedAt", unit };
  if (timezone) truncArg.timezone = timezone;

  const rows = await DispenseLog.aggregate([
    { $match: baseMatch(clinicId, from, to) },
    {
      $group: {
        _id: { $dateTrunc: truncArg },
        qty: { $sum: "$qty" },
        events: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((r) => ({ bucket: r._id, qty: r.qty, events: r.events }));
}
