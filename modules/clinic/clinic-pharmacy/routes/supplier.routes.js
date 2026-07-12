// server/modules/clinic/clinic-pharmacy/routes/supplier.routes.js
//
// Routes for pharmacy suppliers (поставщики). PRIVATE — tenantMiddleware
// upstream; gates (RESOURCES.SUPPLIER) in the controller. Mounted at "/" in
// clinic-pharmacy/index.js.

import express from "express";
import {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  archiveSupplier,
  restoreSupplier,
} from "../controllers/supplier.controller.js";

const router = express.Router();

// Collection
router.get("/pharmacy/suppliers", listSuppliers);
router.post("/pharmacy/suppliers", createSupplier);

// Restore (before bare :id, defensive ordering)
router.post("/pharmacy/suppliers/:id/restore", restoreSupplier);

// Item
router.get("/pharmacy/suppliers/:id", getSupplier);
router.patch("/pharmacy/suppliers/:id", updateSupplier);
router.delete("/pharmacy/suppliers/:id", archiveSupplier); // soft archive

export default router;
