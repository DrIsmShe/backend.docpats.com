// server/modules/radiology/analytics/analytics.routes.js
//
// Аналитика арены — только автору/админу. Роль learner проверена
// агрегатором, requireAuthor сужает до редакторов.

import express from "express";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { requireAuthor } from "../middlewares/radiologyAuth.js";
import {
  getOverview,
  getCasesReport,
  getMissedFindings,
} from "./analytics.service.js";

const router = express.Router();

router.get(
  "/analytics/overview",
  requireAuthor,
  asyncHandler(async (req, res) => res.json(await getOverview())),
);
router.get(
  "/analytics/cases",
  requireAuthor,
  asyncHandler(async (req, res) => res.json({ items: await getCasesReport() })),
);
router.get(
  "/analytics/missed-findings",
  requireAuthor,
  asyncHandler(async (req, res) => res.json({ items: await getMissedFindings() })),
);

export default router;
