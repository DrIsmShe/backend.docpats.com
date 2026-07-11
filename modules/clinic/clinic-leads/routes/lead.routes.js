// server/modules/clinic/clinic-leads/routes/lead.routes.js
//
// Private (manager-zone) lead routes. Mounted in clinic/index.js via
// `router.use("/", clinicLeadsRouter)`, so the full /leads prefix lives here.
// tenantMiddleware upstream scopes the clinic; the controller enforces
// lead.read / lead.write via requirePermission.
//
// The PUBLIC submit route is NOT here — it lives in clinic-public.routes.js
// (unauthenticated, slug-based).

import express from "express";
import * as ctrl from "../controllers/lead.controller.js";

const router = express.Router();

router.get("/leads", ctrl.listLeads);
router.patch("/leads/:leadId", ctrl.updateLeadStatus);

export default router;