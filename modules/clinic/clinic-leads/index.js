// server/modules/clinic/clinic-leads/index.js
//
// Thin aggregator for the clinic-leads module (private routes only).
// Mounted in clinic/index.js with `router.use("/", clinicLeadsRouter)`.
// The public submit route is wired separately in clinic-public.routes.js.

import express from "express";
import leadRoutes from "./routes/lead.routes.js";

const router = express.Router();

router.use("/", leadRoutes);

export default router;