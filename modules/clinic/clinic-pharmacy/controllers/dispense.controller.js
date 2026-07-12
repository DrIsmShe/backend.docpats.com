// server/modules/clinic/clinic-pharmacy/controllers/dispense.controller.js
//
// HTTP controller for dispensing (выдача препарата со склада). PRIVATE.
// clinicId + pharmacist membership come from the ALS tenant context; the
// service self-scopes and runs the whole thing transactionally.
//
// Permission gate:
//   base                → INVENTORY WRITE   (stock movement)
//   target = "patient"  → + PRESCRIPTION READ
//
// Side effect of that split: a nurse (INVENTORY: RW, no PRESCRIPTION) can
// dispense against a requisition or to a department, but CANNOT dispense
// directly to a patient — that stays with the pharmacist (PRESCRIPTION: RW).
//
// The journal listing / period reports are a separate concern (п.5), so no
// GET here yet.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import {
  require as requirePermission,
  ACTIONS,
} from "../../../../common/auth/can.js";
import { RESOURCES } from "../../../../common/auth/permissions.js";
import * as dispenseService from "../services/dispense.service.js";

// ── POST /api/v1/clinic/pharmacy/dispense ─────────────────
// Body: { drugItemId, qty, target, requisitionId?, requisitionItemId?,
//         departmentId?, patientId?, prescriptionId?, note? }
export const dispense = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.INVENTORY, ACTIONS.WRITE);

  // Dispensing to a patient additionally requires prescription read access.
  if ((req.body || {}).target === "patient") {
    requirePermission(RESOURCES.PRESCRIPTION, ACTIONS.READ);
  }

  const result = await dispenseService.dispense(req.body || {});

  // { dispenseLog, requisition|null }
  res.status(201).json(result);
});
