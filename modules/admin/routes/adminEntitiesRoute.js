// modules/admin/routes/adminEntitiesRoute.js
//
// Admin-обзор врачей/приёмов + рассылка уведомлений. Всё под requireAdmin.
// Монтируется в admin/index.js на "/".

import { Router } from "express";
import requireAdmin from "./isAdminRoute.js";
import {
  listDoctors,
  appointmentsOverview,
  broadcastNotification,
  verificationQueue,
} from "../controllers/adminEntities.controller.js";

const router = Router();
router.use(requireAdmin);

router.get("/doctors", listDoctors);
router.get("/appointments-overview", appointmentsOverview);
router.post("/notifications/broadcast", broadcastNotification);
router.get("/verification-queue", verificationQueue);

export default router;
