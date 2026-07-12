// server/modules/clinic/clinic-pharmacy/routes/drugItem.routes.js
//
// Routes for the drug formulary (номенклатура). All PRIVATE — mounted under
// the clinic router, which already applied tenantMiddleware upstream, so no
// auth/tenant middleware here. Permission enforcement lives inside each
// controller (requirePermission(RESOURCES.PHARMACY, ...)), same as leads.
//
// Full paths are declared here (under /pharmacy/drug-items) and the router is
// mounted at "/" in clinic-pharmacy/index.js — matching the lead router
// convention (paths in the route file, mount at root).

import express from "express";
import {
  listDrugItems,
  getDrugItem,
  createDrugItem,
  updateDrugItem,
  archiveDrugItem,
  restoreDrugItem,
} from "../controllers/drugItem.controller.js";

const router = express.Router();

// Collection
router.get("/pharmacy/drug-items", listDrugItems);
router.post("/pharmacy/drug-items", createDrugItem);

// Item
router.get("/pharmacy/drug-items/:id", getDrugItem);
router.patch("/pharmacy/drug-items/:id", updateDrugItem);
router.delete("/pharmacy/drug-items/:id", archiveDrugItem); // soft archive

// Restore an archived item
router.post("/pharmacy/drug-items/:id/restore", restoreDrugItem);

export default router;
