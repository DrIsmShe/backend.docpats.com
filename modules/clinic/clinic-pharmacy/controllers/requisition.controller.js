// server/modules/clinic/clinic-pharmacy/controllers/requisition.controller.js
//
// HTTP controllers for stock requisitions (заявки отделений в аптеку).
// PRIVATE (clinic zone). clinicId + creating membership come from the ALS
// tenant context; the service self-scopes. Style mirrors the other pharmacy
// controllers.
//
// Permission gate = RESOURCES.REQUISITION:
//   create / submit / cancel / updateDraft → WRITE  (nurse authors it)
//   list / get                             → READ   (pharmacist queue, views)
//
// Author vs fulfiller is NOT split by RBAC (both have REQUISITION write) — it's
// enforced by the lifecycle: nurses create/submit here; pharmacist fulfilment
// (qtyDispensed, status, FEFO, DispenseLog) is the dispense route (п.4).

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import {
  require as requirePermission,
  ACTIONS,
} from "../../../../common/auth/can.js";
import { RESOURCES } from "../../../../common/auth/permissions.js";
import * as reqService from "../services/requisition.service.js";

// ── GET /api/v1/clinic/pharmacy/requisitions ──────────────
// Filters: ?status=submitted,partially_dispensed  ?departmentId=  ?mine=true
export const listRequisitions = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.REQUISITION, ACTIONS.READ);

  const { status, departmentId, mine, limit, skip } = req.query;

  const result = await reqService.listRequisitions({
    status,
    departmentId,
    mine: mine === "true",
    limit,
    skip,
  });

  res.json(result); // { requisitions, total }
});

// ── GET /api/v1/clinic/pharmacy/requisitions/:id ──────────
export const getRequisition = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.REQUISITION, ACTIONS.READ);

  const { id } = req.params;
  const requisition = await reqService.getRequisitionById(id);

  res.json({ requisition });
});

// ── POST /api/v1/clinic/pharmacy/requisitions ─────────────
// Body: { departmentId, items:[{drugItemId, qtyRequested, note}], priority,
//         note, submit }
export const createRequisition = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.REQUISITION, ACTIONS.WRITE);

  const requisition = await reqService.createRequisition(req.body || {});

  res.status(201).json({ requisition });
});

// ── PATCH /api/v1/clinic/pharmacy/requisitions/:id ────────
// Draft-only edit. Body: { departmentId?, items?, priority?, note? }
export const updateRequisitionDraft = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.REQUISITION, ACTIONS.WRITE);

  const { id } = req.params;
  const requisition = await reqService.updateDraft(id, req.body || {});

  res.json({ requisition });
});

// ── POST /api/v1/clinic/pharmacy/requisitions/:id/submit ──
export const submitRequisition = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.REQUISITION, ACTIONS.WRITE);

  const { id } = req.params;
  const requisition = await reqService.submitRequisition(id);

  res.json({ requisition });
});

// ── POST /api/v1/clinic/pharmacy/requisitions/:id/cancel ──
export const cancelRequisition = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.REQUISITION, ACTIONS.WRITE);

  const { id } = req.params;
  const requisition = await reqService.cancelRequisition(id);

  res.json({ requisition });
});
