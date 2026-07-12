// server/modules/clinic/clinic-pharmacy/controllers/supplier.controller.js
//
// HTTP controllers for pharmacy suppliers (поставщики). PRIVATE. clinicId from
// the ALS tenant context; the service self-scopes. Style mirrors
// drugItem.controller.js.
//
// Permission gate = RESOURCES.SUPPLIER:
//   list / getOne          → READ   (pharmacist RW, accountant RO, admin FULL)
//   create / update        → WRITE
//   archive / restore      → WRITE   (soft, reversible)

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import {
  require as requirePermission,
  ACTIONS,
} from "../../../../common/auth/can.js";
import { RESOURCES } from "../../../../common/auth/permissions.js";
import * as supplierService from "../services/supplier.service.js";

// ── GET /api/v1/clinic/pharmacy/suppliers ─────────────────
export const listSuppliers = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.SUPPLIER, ACTIONS.READ);

  const { search, includeArchived, limit, skip } = req.query;

  const result = await supplierService.listSuppliers({
    search,
    includeArchived: includeArchived === "true",
    limit,
    skip,
  });

  res.json(result); // { items, total }
});

// ── GET /api/v1/clinic/pharmacy/suppliers/:id ─────────────
export const getSupplier = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.SUPPLIER, ACTIONS.READ);

  const { id } = req.params;
  const supplier = await supplierService.getSupplierById(id);

  res.json({ supplier });
});

// ── POST /api/v1/clinic/pharmacy/suppliers ────────────────
export const createSupplier = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.SUPPLIER, ACTIONS.WRITE);

  const supplier = await supplierService.createSupplier(req.body || {});

  res.status(201).json({ supplier });
});

// ── PATCH /api/v1/clinic/pharmacy/suppliers/:id ───────────
export const updateSupplier = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.SUPPLIER, ACTIONS.WRITE);

  const { id } = req.params;
  const supplier = await supplierService.updateSupplier(id, req.body || {});

  res.json({ supplier });
});

// ── DELETE /api/v1/clinic/pharmacy/suppliers/:id ──────────
// Soft archive (status → "archived"), gated at WRITE.
export const archiveSupplier = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.SUPPLIER, ACTIONS.WRITE);

  const { id } = req.params;
  const supplier = await supplierService.archiveSupplier(id);

  res.json({ supplier });
});

// ── POST /api/v1/clinic/pharmacy/suppliers/:id/restore ────
export const restoreSupplier = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.SUPPLIER, ACTIONS.WRITE);

  const { id } = req.params;
  const supplier = await supplierService.restoreSupplier(id);

  res.json({ supplier });
});
