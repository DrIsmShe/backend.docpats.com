// modules/admin/routes/adminOverviewRoute.js
//
// Сводный дашборд платформы + просмотр HIPAA аудит-лога. Всё под requireAdmin.
// Монтируется в admin/index.js на "/" → /admin/overview, /admin/audit-log.

import { Router } from "express";
import requireAdmin from "./isAdminRoute.js";
import { getOverview, getAuditLog } from "../controllers/adminOverview.controller.js";

const router = Router();
router.use(requireAdmin);

router.get("/overview", getOverview);
router.get("/audit-log", getAuditLog);

export default router;
