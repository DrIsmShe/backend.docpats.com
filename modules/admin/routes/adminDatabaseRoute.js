// server/modules/admin/routes/adminDatabaseRoute.js
import { Router } from "express";
import requireAdmin from "./isAdminRoute.js";
import adminDatabaseController, {
  exportAnalyticsPdf,
  emailAnalyticsPdf,
} from "../controllers/adminDatabase.controller.js";

const router = Router();

// GET /admin/database/analytics — сводная аналитика платформы (JSON)
router.get("/analytics", requireAdmin, adminDatabaseController);

// GET /admin/database/export/pdf?sections=all|patients,articles,... — скачать PDF
router.get("/export/pdf", requireAdmin, exportAnalyticsPdf);

// POST /admin/database/email { email, sections } — отправить PDF на почту
router.post("/email", requireAdmin, emailAnalyticsPdf);

export default router;
