// server/modules/clinic/clinic-analytics/routes/analytics.routes.js
//
// Routes for clinic-analytics. Mounted in clinic/index.js via
// `router.use("/", clinicAnalyticsRouter)`, so the full /analytics prefix
// lives here. Read-only module.
//
// Unlike the other clinic-* route files, the controller performs an explicit
// requirePermission(analytics.read) check. Analytics is read-only and the
// backend gate is cheap, so we enforce it server-side rather than relying on
// frontend gating alone. tenantMiddleware upstream still scopes the clinic.

import express from "express";
import * as ctrl from "../controllers/analytics.controller.js";

const router = express.Router();

router.get("/analytics/overview", ctrl.getOverview);

export default router;