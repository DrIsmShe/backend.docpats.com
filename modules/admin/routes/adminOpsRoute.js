// modules/admin/routes/adminOpsRoute.js
//
// п.2 безопасность, п.3 модерация отзывов, п.5 статус системы. Всё под requireAdmin.
// Монтируется в admin/index.js на "/".

import { Router } from "express";
import requireAdmin from "./isAdminRoute.js";
import {
  securityDashboard,
  systemHealth,
} from "../controllers/adminOps.controller.js";
import {
  listReviews,
  moderateReview,
} from "../controllers/adminModeration.controller.js";

const router = Router();
router.use(requireAdmin);

router.get("/security-dashboard", securityDashboard);
router.get("/system-health", systemHealth);
router.get("/reviews", listReviews);
router.patch("/reviews/:id", moderateReview);

export default router;
