// server/modules/clinic/clinic-pharmacy/services/dispense.service.js
//
// The dispense orchestrator — where the whole pharmacy flow closes:
//   FEFO batch consumption + append-only DispenseLog + (optional) requisition
//   fulfilment, all in ONE Mongo transaction (all-or-nothing), followed by a
//   fire-and-forget audit entry.
//
// Channels (target): "requisition" | "patient" | "department" — see
// dispenseLog.model.js.
//
// Atlas is always a replica set (even M0), so transactions work. We still
// degrade gracefully: if the deployment reports transactions unsupported, we
// re-run the same work without a session (best-effort, non-atomic).
//
// Audit: recordActionAsync is loaded defensively via dynamic import so a wrong
// path can NEVER crash the server or a dispense — audit failure is logged and
// swallowed (correct posture for fire-and-forget). ⚠ VERIFY the module path
// + export name in loadAuditRecorder() below and adjust if needed.

import mongoose from "mongoose";
import DispenseLog from "../models/dispenseLog.model.js";
import DrugItem from "../models/drugItem.model.js";
import Requisition from "../models/requisition.model.js";
import { consumeFEFO } from "./drugBatch.service.js";
import {
  getCurrentClinicId,
  getCurrentMembershipId,
  getCurrentUserId,
  getCurrentRole,
} from "../../../../common/context/tenantContext.js";

// ── error helper ───────────────────────────────────────────
function httpError(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  if (code) err.code = code;
  return err;
}

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw httpError("No clinic context", 401, "NO_CLINIC_CONTEXT");
  return clinicId;
}

function requireMembershipId() {
  const membershipId = getCurrentMembershipId();
  if (!membershipId) {
    throw httpError("No membership context", 401, "NO_MEMBERSHIP_CONTEXT");
  }
  return membershipId;
}

// ── defensive audit ────────────────────────────────────────
// ⚠ Adjust path/export to match your audit module. If it doesn't resolve,
// dispensing still works — audit is just skipped (logged).
async function loadAuditRecorder() {
  try {
    const mod = await import("../../../../common/audit/audit.service.js");
    return mod.recordActionAsync || mod.default || null;
  } catch (e) {
    console.error("[dispense] audit module not loaded:", e?.message);
    return null;
  }
}

function auditDispenseSafe(entry) {
  // fire-and-forget: never await from the caller's perspective
  loadAuditRecorder()
    .then((record) => {
      if (typeof record !== "function") return;
      record({
        action: "pharmacy.dispense",
        actor: {
          userId: getCurrentUserId() ? String(getCurrentUserId()) : null,
          email: null, // no email getter in context; fill if you add one
          role: getCurrentRole() || null,
        },
        clinicId: entry.clinicId,
        resource: "dispense_log",
        resourceId: entry.dispenseLogId,
        meta: {
          drugItemId: entry.drugItemId,
          qty: entry.qty,
          target: entry.target,
          requisitionId: entry.requisitionId || null,
          patientId: entry.patientId || null,
          departmentId: entry.departmentId || null,
          isControlled: entry.isControlled,
        },
      });
    })
    .catch((e) => console.error("[dispense] audit skipped:", e?.message));
}

// ── txn support detection ──────────────────────────────────
function isTxnUnsupported(err) {
  const msg = String(err?.message || "");
  return (
    err?.code === 20 || // IllegalOperation
    /Transaction numbers are only allowed on a replica set|replica set member or mongos|does not support transactions|Transactions are not supported/i.test(
      msg,
    )
  );
}

// ── core work (runs with or without a session) ─────────────
async function doDispenseWork(ctx) {
  const {
    session,
    clinicId,
    membershipId,
    drug,
    qty,
    target,
    requisitionId,
    requisitionItemId,
    departmentId: departmentIdInput,
    patientId,
    prescriptionId,
    note,
  } = ctx;

  let departmentId = departmentIdInput || null;
  let reqDoc = null;
  let reqLine = null;

  // 1) If fulfilling a requisition, load + validate it first (need remaining
  //    qty and the department for the log).
  if (target === "requisition") {
    reqDoc = await Requisition.findOne({
      _id: requisitionId,
      clinicId,
    }).session(session || null);

    if (!reqDoc) throw httpError("Requisition not found", 404, "REQ_NOT_FOUND");
    if (!["submitted", "partially_dispensed"].includes(reqDoc.status)) {
      throw httpError(
        `Requisition is ${reqDoc.status}, not fulfillable`,
        409,
        "REQ_NOT_FULFILLABLE",
      );
    }

    reqLine = reqDoc.items.id(requisitionItemId);
    if (!reqLine) {
      throw httpError("Requisition line not found", 404, "REQ_LINE_NOT_FOUND");
    }
    if (String(reqLine.drugItemId) !== String(drug._id)) {
      throw httpError(
        "drugItemId does not match the requisition line",
        400,
        "DRUG_MISMATCH",
      );
    }

    const remaining = reqLine.qtyRequested - (reqLine.qtyDispensed || 0);
    if (qty > remaining) {
      throw httpError(
        `Requested ${qty} exceeds remaining ${remaining} on this line`,
        409,
        "OVER_DISPENSE",
      );
    }

    departmentId = reqDoc.departmentId;
  }

  // 2) Consume stock FEFO (inside the session).
  const { allocation } = await consumeFEFO(drug._id, qty, { session });

  // 3) Append the immutable journal entry.
  const [log] = await DispenseLog.create(
    [
      {
        clinicId,
        drugItemId: drug._id,
        qty,
        batches: allocation.map((a) => ({
          batchId: a.batchId,
          batchNo: a.batchNo,
          expiryDate: a.expiryDate,
          qty: a.taken,
        })),
        isControlled: !!drug.isControlled,
        target,
        requisitionId: target === "requisition" ? requisitionId : null,
        requisitionItemId: target === "requisition" ? requisitionItemId : null,
        departmentId: target === "patient" ? null : departmentId || null,
        patientId: target === "patient" ? patientId : null,
        prescriptionId: target === "patient" ? prescriptionId || null : null,
        dispensedByMembershipId: membershipId,
        dispensedAt: new Date(),
        note: note ? String(note).slice(0, 1000) : "",
      },
    ],
    { session: session || undefined },
  );

  // 4) If requisition: bump the line + recompute requisition status.
  if (target === "requisition" && reqDoc && reqLine) {
    reqLine.qtyDispensed = (reqLine.qtyDispensed || 0) + qty;

    const allDone = reqDoc.items.every(
      (it) => (it.qtyDispensed || 0) >= it.qtyRequested,
    );
    const anyDone = reqDoc.items.some((it) => (it.qtyDispensed || 0) > 0);
    reqDoc.status = allDone
      ? "dispensed"
      : anyDone
        ? "partially_dispensed"
        : reqDoc.status;

    reqDoc.handledByMembershipId = membershipId;
    reqDoc.handledAt = new Date();

    await reqDoc.save({ session: session || undefined });
  }

  return {
    dispenseLog: typeof log.toObject === "function" ? log.toObject() : log,
    requisition: reqDoc ? (reqDoc.toObject ? reqDoc.toObject() : reqDoc) : null,
  };
}

/**
 * Dispense a quantity of a drug through one channel.
 *
 * @param {object} input
 * @param {string} input.drugItemId       REQUIRED
 * @param {number} input.qty              REQUIRED baseUnit, > 0
 * @param {"requisition"|"patient"|"department"} input.target  REQUIRED
 * @param {string} [input.requisitionId]      target=requisition
 * @param {string} [input.requisitionItemId]  target=requisition
 * @param {string} [input.departmentId]       target=department
 * @param {string} [input.patientId]          target=patient
 * @param {string} [input.prescriptionId]     target=patient (optional)
 * @param {string} [input.note]
 * @returns {Promise<{dispenseLog: object, requisition: object|null}>}
 */
export async function dispense(input = {}) {
  const clinicId = requireClinicId();
  const membershipId = requireMembershipId();

  const {
    drugItemId,
    qty,
    target,
    requisitionId,
    requisitionItemId,
    departmentId,
    patientId,
    prescriptionId,
    note,
  } = input;

  // ── validate ──
  if (!drugItemId) throw httpError("drugItemId required", 400);
  const need = Number(qty);
  if (!Number.isFinite(need) || need <= 0) {
    throw httpError("qty must be > 0", 400, "BAD_QTY");
  }
  if (!["requisition", "patient", "department"].includes(target)) {
    throw httpError("invalid target", 400, "BAD_TARGET");
  }
  if (target === "requisition" && (!requisitionId || !requisitionItemId)) {
    throw httpError(
      "requisitionId + requisitionItemId required for target=requisition",
      400,
      "REQ_REFS_REQUIRED",
    );
  }
  if (target === "patient" && !patientId) {
    throw httpError(
      "patientId required for target=patient",
      400,
      "PATIENT_REQUIRED",
    );
  }
  if (target === "department" && !departmentId) {
    throw httpError(
      "departmentId required for target=department",
      400,
      "DEPARTMENT_REQUIRED",
    );
  }

  // Drug must exist in THIS clinic (isControlled snapshot comes from here).
  const drug = await DrugItem.findOne({ _id: drugItemId, clinicId })
    .select("_id isControlled status")
    .lean();
  if (!drug) throw httpError("Drug item not found", 404, "DRUG_ITEM_NOT_FOUND");

  const workCtx = {
    clinicId,
    membershipId,
    drug,
    qty: Math.round(need),
    target,
    requisitionId,
    requisitionItemId,
    departmentId,
    patientId,
    prescriptionId,
    note,
  };

  // ── run: transaction first, graceful fallback if unsupported ──
  let result;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      result = await doDispenseWork({ ...workCtx, session });
    });
  } catch (err) {
    if (isTxnUnsupported(err)) {
      console.warn(
        "[dispense] transactions unsupported — running non-atomically",
      );
      result = await doDispenseWork({ ...workCtx, session: null });
    } else {
      throw err;
    }
  } finally {
    await session.endSession();
  }

  // ── audit (fire-and-forget, after commit) ──
  auditDispenseSafe({
    clinicId: String(clinicId),
    dispenseLogId: String(result.dispenseLog._id),
    drugItemId: String(drugItemId),
    qty: workCtx.qty,
    target,
    requisitionId: requisitionId || null,
    patientId: patientId || null,
    departmentId: result.dispenseLog.departmentId
      ? String(result.dispenseLog.departmentId)
      : null,
    isControlled: !!drug.isControlled,
  });

  return result;
}
