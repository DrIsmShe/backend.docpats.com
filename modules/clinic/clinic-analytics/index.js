// server/modules/clinic/clinic-analytics/index.js
//
// Thin aggregator for the clinic-analytics module. Mounted in
// clinic/index.js with `router.use("/", clinicAnalyticsRouter)`.

import express from "express";
import analyticsRoutes from "./routes/analytics.routes.js";

const router = express.Router();

router.use("/", analyticsRoutes);

export default router;