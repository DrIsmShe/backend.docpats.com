// server/modules/clinic/clinic-pharmacy/routes/pharmacyReport.routes.js
//
// Routes for pharmacy dispense reports. PRIVATE — tenantMiddleware upstream;
// gate (INVENTORY READ) in the controller. Mounted at "/" in
// clinic-pharmacy/index.js.

import express from "express";
import {
  getDispenseReport,
  getDispenseReportPdf,
} from "../controllers/pharmacyReport.controller.js";

const router = express.Router();

router.get("/pharmacy/reports/dispense", getDispenseReport);
router.get("/pharmacy/reports/dispense.pdf", getDispenseReportPdf);

export default router;
