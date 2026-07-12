// server/modules/clinic/clinic-pharmacy/controllers/drugBatch.controller.js
//
// HTTP controllers for pharmacy stock batches (партии / приход / остатки).
// PRIVATE (clinic zone). clinicId comes from the ALS tenant context; the
// service self-scopes. Style mirrors drugItem.controller.js.
//
// Permission gate = RESOURCES.INVENTORY (NOT pharmacy), on purpose:
// permissions.js separates INVENTORY (stock movements) from PHARMACY (the drug
// formulary). nurse & manager have INVENTORY: RW but no/limited PHARMACY, so
// receiving stock and reading levels is allowed for them, while editing the
// catalog stays pharmacist/admin-only.
//   receive (приход) / write-off  → INVENTORY WRITE
//   list / stock / expiring        → INVENTORY READ
//
// NOTE: dispensing (consumeFEFO) is intentionally NOT exposed here. It belongs
// to the dispense service/route (п.4), wrapped with DispenseLog + audit.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import {
  require as requirePermission,
  ACTIONS,
} from "../../../../common/auth/can.js";
import { RESOURCES } from "../../../../common/auth/permissions.js";
import * as batchService from "../services/drugBatch.service.js";

// ── POST /api/v1/clinic/pharmacy/drug-items/:id/batches ───
// Receive a new batch (приход) for the given drug item.
export const receiveBatch = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.INVENTORY, ACTIONS.WRITE);

  const { id } = req.params;
  const batch = await batchService.receiveBatch({
    ...(req.body || {}),
    drugItemId: id,
  });

  res.status(201).json({ batch });
});

// ── GET /api/v1/clinic/pharmacy/drug-items/:id/batches ────
export const listBatches = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.INVENTORY, ACTIONS.READ);

  const { id } = req.params;
  const includeInactive = req.query.includeInactive === "true";
  const batches = await batchService.listBatches(id, { includeInactive });

  res.json({ batches });
});

// ── GET /api/v1/clinic/pharmacy/drug-items/:id/stock ──────
export const getStock = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.INVENTORY, ACTIONS.READ);

  const { id } = req.params;
  const stock = await batchService.getStock(id);

  res.json(stock); // { drugItemId, stock, batchCount, nearestExpiry }
});

// ── GET /api/v1/clinic/pharmacy/batches/expiring ──────────
// Clinic-wide "expires within N days" report. ?days=30 (default).
export const expiringSoon = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.INVENTORY, ACTIONS.READ);

  const days = Math.max(1, Number(req.query.days) || 30);
  const batches = await batchService.expiringSoon(days);

  res.json({ days, batches });
});
