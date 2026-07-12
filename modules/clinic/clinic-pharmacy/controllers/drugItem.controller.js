// server/modules/clinic/clinic-pharmacy/controllers/drugItem.controller.js
//
// HTTP controllers for the drug formulary (номенклатура препаратов клиники).
// All handlers are PRIVATE (pharmacist / owner / admin zone) — there is no
// public catalog. clinicId always comes from the ALS tenant context, never
// from a client-supplied value; the service self-scopes to it.
//
// Permission gates (RESOURCES.PHARMACY):
//   list / getOne          → READ
//   create / update        → WRITE
//   archive / restore      → WRITE  (soft, reversible status change; keeping
//                            it at WRITE lets admin [PHARMACY: RW] manage the
//                            catalog. Switch to ACTIONS.DELETE if you want
//                            archive locked to pharmacist/owner only.)
//
// Style mirrors lead.controller.js: asyncHandler wraps each handler,
// requirePermission throws ForbiddenError, errors flow to the central
// errorHandler. Service is namespaced as drugItemService.*.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import {
  require as requirePermission,
  ACTIONS,
} from "../../../../common/auth/can.js";
import { RESOURCES } from "../../../../common/auth/permissions.js";
import * as drugItemService from "../services/drugItem.service.js";

// ── query param coercion ──────────────────────────────────
// Query strings arrive as strings; normalise the tri-state / boolean ones.
function parseTriBool(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined; // absent → no filter
}

// ── GET /api/v1/clinic/pharmacy/drug-items ────────────────
export const listDrugItems = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.PHARMACY, ACTIONS.READ);

  const { search, category, isControlled, includeArchived, limit, skip } =
    req.query;

  const result = await drugItemService.listDrugItems({
    search,
    category,
    isControlled: parseTriBool(isControlled),
    includeArchived: includeArchived === "true",
    limit,
    skip,
  });

  res.json(result); // { items, total }
});

// ── GET /api/v1/clinic/pharmacy/drug-items/:id ────────────
export const getDrugItem = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.PHARMACY, ACTIONS.READ);

  const { id } = req.params;
  const item = await drugItemService.getDrugItemById(id);

  res.json({ item });
});

// ── POST /api/v1/clinic/pharmacy/drug-items ───────────────
export const createDrugItem = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.PHARMACY, ACTIONS.WRITE);

  const item = await drugItemService.createDrugItem(req.body || {});

  res.status(201).json({ item });
});

// ── PATCH /api/v1/clinic/pharmacy/drug-items/:id ──────────
export const updateDrugItem = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.PHARMACY, ACTIONS.WRITE);

  const { id } = req.params;
  const item = await drugItemService.updateDrugItem(id, req.body || {});

  res.json({ item });
});

// ── DELETE /api/v1/clinic/pharmacy/drug-items/:id ─────────
// Soft archive (status → "archived"). Gated at WRITE, not DELETE — see header.
export const archiveDrugItem = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.PHARMACY, ACTIONS.WRITE);

  const { id } = req.params;
  const item = await drugItemService.archiveDrugItem(id);

  res.json({ item });
});

// ── POST /api/v1/clinic/pharmacy/drug-items/:id/restore ───
export const restoreDrugItem = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.PHARMACY, ACTIONS.WRITE);

  const { id } = req.params;
  const item = await drugItemService.restoreDrugItem(id);

  res.json({ item });
});
