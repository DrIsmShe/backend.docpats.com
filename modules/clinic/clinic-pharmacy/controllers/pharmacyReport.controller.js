// server/modules/clinic/clinic-pharmacy/controllers/pharmacyReport.controller.js
//
// HTTP controller for pharmacy dispense reports. PRIVATE. clinicId from the
// ALS tenant context; the service self-scopes and casts clinicId to ObjectId
// inside every aggregation $match.
//
// Gate = RESOURCES.INVENTORY READ — leadership (owner/admin/manager all hold
// INVENTORY) and the pharmacist (INVENTORY: RW) can all read the dispense
// report. No financial data here, so ANALYTICS_FINANCE isn't required.
//
// GET /api/v1/clinic/pharmacy/reports/dispense
//   ?period=day|week|month|quarter|year        (default month)
//   &date=<ISO>                                 reference date inside period
//   &from=<ISO>&to=<ISO>                        explicit range (overrides period)
//   &bucket=day|week|month                      time-series granularity
//   &tz=<IANA>                                  time-series timezone
//   &topDrugs=<n>

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import {
  require as requirePermission,
  ACTIONS,
} from "../../../../common/auth/can.js";
import { RESOURCES } from "../../../../common/auth/permissions.js";
import * as reportService from "../services/pharmacyReport.service.js";
import { streamDispenseReportPdf } from "../services/pharmacyReportPdf.service.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";

const PERIOD_LABELS = {
  day: "Сутки",
  week: "Неделя",
  month: "Месяц",
  quarter: "Квартал",
  year: "Год",
  custom: "Произвольный период",
};

// Sensible default time-series bucket for a given period.
const DEFAULT_BUCKET = {
  day: "day",
  week: "day",
  month: "day",
  quarter: "week",
  year: "month",
};

export const getDispenseReport = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.INVENTORY, ACTIONS.READ);

  const {
    period = "month",
    date,
    from: fromRaw,
    to: toRaw,
    bucket,
    tz,
    topDrugs,
  } = req.query;

  // Explicit from/to wins; otherwise resolve the named period.
  let from;
  let to;
  let resolvedPeriod = period;

  if (fromRaw && toRaw) {
    from = new Date(fromRaw);
    to = new Date(toRaw);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ error: "Invalid from/to" });
    }
    if (from >= to) {
      return res.status(400).json({ error: "from must be before to" });
    }
    resolvedPeriod = "custom";
  } else {
    const win = reportService.resolvePeriod(period, date);
    from = win.from;
    to = win.to;
  }

  const chosenBucket = bucket || DEFAULT_BUCKET[resolvedPeriod] || "day";

  const [summary, series] = await Promise.all([
    reportService.getPeriodSummary({
      from,
      to,
      topDrugsLimit: topDrugs ? Number(topDrugs) : 20,
    }),
    reportService.getTimeSeries({
      from,
      to,
      bucket: chosenBucket,
      timezone: tz,
    }),
  ]);

  res.json({
    period: resolvedPeriod,
    range: { from, to },
    bucket: chosenBucket,
    summary,
    series,
  });
});

// ── GET /api/v1/clinic/pharmacy/reports/dispense.pdf ──────
// Same params as the JSON report; streams a leadership PDF. No time-series in
// the PDF — summary only.
export const getDispenseReportPdf = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.INVENTORY, ACTIONS.READ);

  const { period = "month", date, from: fromRaw, to: toRaw } = req.query;

  let from;
  let to;
  let resolvedPeriod = period;

  if (fromRaw && toRaw) {
    from = new Date(fromRaw);
    to = new Date(toRaw);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from >= to
    ) {
      return res.status(400).json({ error: "Invalid from/to" });
    }
    resolvedPeriod = "custom";
  } else {
    const win = reportService.resolvePeriod(period, date);
    from = win.from;
    to = win.to;
  }

  const summary = await reportService.getPeriodSummary({ from, to });

  // Clinic name for the header (best-effort; don't fail the PDF over it).
  let clinicName = "";
  try {
    const clinicId = getCurrentClinicId();
    const Clinic = (await import("../../clinic-core/models/clinic.model.js"))
      .default;
    const clinic = await Clinic.findById(clinicId).select("name").lean();
    clinicName = clinic?.name || "";
  } catch {
    clinicName = "";
  }

  streamDispenseReportPdf({
    res,
    summary,
    clinic: { name: clinicName },
    periodLabel: PERIOD_LABELS[resolvedPeriod] || "",
    filename: `pharmacy-report-${resolvedPeriod}.pdf`,
  });
});
