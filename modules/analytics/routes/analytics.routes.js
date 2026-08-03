// modules/analytics/routes/analytics.routes.js
//
// Маршруты админского дашборда посещаемости.
// Монтируются в modules/admin/index.js → /admin/analytics/*
//
// requireAdmin стоит на всём роутере: статистика показывает, какие экраны и
// сколько раз открывали, — это внутренние данные продукта, и посторонним
// (включая обычных врачей) их видеть незачем.

import { Router } from "express";
import requireAdmin from "../../admin/routes/isAdminRoute.js";
import {
  getStatus,
  getOverview,
  getPages,
  getAudience,
  getAcquisition,
  getBehavior,
  getPerformance,
  getLive,
  getEventLog,
  getEventDetail,
  refresh,
} from "../controllers/analytics.controller.js";

const router = Router();
router.use(requireAdmin);

router.get("/status", getStatus);
router.get("/overview", getOverview);
router.get("/pages", getPages);
router.get("/audience", getAudience);
router.get("/acquisition", getAcquisition);
router.get("/behavior", getBehavior);
router.get("/performance", getPerformance);
router.get("/live", getLive);
router.get("/events", getEventLog);
router.get("/event", getEventDetail);
router.post("/refresh", refresh);

export default router;
