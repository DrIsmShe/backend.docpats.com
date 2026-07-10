// server/modules/clinic/clinic-analytics/controllers/analytics.controller.js
//
// HTTP controllers for the clinic-analytics module.
//
// Style mirrors department.controller.js:
//   • asyncHandler wraps each handler — errors flow to the central
//     errorHandler, no local try/catch.
//   • clinicId is resolved from the ALS tenant context (tenantMiddleware sets
//     it upstream for both user-owner and ClinicEmployee zones).
//   • Permission enforcement via require() (throwing variant) at the top of
//     each handler — analytics.read. Manager has RO on analytics; owner/admin
//     inherit it. Financial analytics live behind analytics_finance and are
//     not touched here.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";
import { ForbiddenError } from "../../../../common/utils/errors.js";
import {
  require as requirePermission,
  ACTIONS,
} from "../../../../common/auth/can.js";
import { RESOURCES } from "../../../../common/auth/permissions.js";
import * as analyticsService from "../services/analytics.service.js";

// ── helpers ───────────────────────────────────────────────
// clinicId is resolved from ALS tenant-context (tenantMiddleware sets it
// higher up the stack — for both a user-owner and a ClinicEmployee).
function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ForbiddenError("No active clinic context");
  return clinicId;
}

// ── GET /clinic/analytics/overview ────────────────────────
//
// Query params:
//   range — one of RANGE_PRESETS keys (day | week | month | half_year |
//           year | three_years | five_years | all). Optional; the service
//           falls back to DEFAULT_RANGE ("month") for a missing/unknown key,
//           so no hard validation is needed here.
//
// Returns the full v1 analytics DTO (see analytics.service.getOverview).
export const getOverview = asyncHandler(async (req, res) => {
  // Read gate: manager (RO) / admin / owner. Throws ForbiddenError -> 403.
  requirePermission(RESOURCES.ANALYTICS, ACTIONS.READ);

  const clinicId = requireClinicId();
  const { range } = req.query;

  const overview = await analyticsService.getOverview({ clinicId, range });

  res.json({ overview });
});