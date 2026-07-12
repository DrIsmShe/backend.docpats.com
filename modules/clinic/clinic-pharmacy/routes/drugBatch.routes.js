// server/modules/clinic/clinic-pharmacy/routes/drugBatch.routes.js
//
// Routes for pharmacy stock batches (партии / приход / остатки). PRIVATE —
// tenantMiddleware applied upstream in clinic/index.js; permission gates live
// inside the controller (RESOURCES.INVENTORY). Paths declared here, router
// mounted at "/" in clinic-pharmacy/index.js.

import express from "express";
import {
  receiveBatch,
  listBatches,
  getStock,
  expiringSoon,
} from "../controllers/drugBatch.controller.js";

const router = express.Router();

// Clinic-wide report — declared BEFORE any :id path (defensive ordering).
router.get("/pharmacy/batches/expiring", expiringSoon);

// Per-drug batch operations (:id = drugItemId).
router.get("/pharmacy/drug-items/:id/batches", listBatches);
router.post("/pharmacy/drug-items/:id/batches", receiveBatch); // приход
router.get("/pharmacy/drug-items/:id/stock", getStock);

export default router;
