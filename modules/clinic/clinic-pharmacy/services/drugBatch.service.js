// server/modules/clinic/clinic-pharmacy/services/drugBatch.service.js
//
// Stock logic for pharmacy batches. Every operation is scoped to the current
// clinic via getCurrentClinicId(); a caller can never touch another clinic's
// batches. No .aggregate() here on purpose — stock is computed with
// find + reduce so the tenantScopedPlugin / softDeletePlugin stay in effect
// (aggregate would bypass them and force manual clinicId $match).
//
// Core:
//   • receiveBatch()  — приход. Converts packs→baseUnit using the DrugItem's
//                        unitsPerPack, creates a batch (quantity=initialQty).
//   • getStock()      — Σ quantity of ACTIVE, non-expired batches.
//   • consumeFEFO()   — draw down `qty` from soonest-expiring batches first;
//                        returns the per-batch allocation (feeds DispenseLog).
//   • listBatches()   — batches of a drug (read).
//   • expiringSoon()  — clinic-wide "expires within N days" report.
//
// consumeFEFO does NOT write an audit/DispenseLog entry — separation of
// concerns: it only moves stock and reports what it took. The dispense
// service (later) wraps consumeFEFO + DispenseLog + recordActionAsync,
// ideally in a session/transaction.

import DrugBatch from "../models/drugBatch.model.js";
import DrugItem from "../models/drugItem.model.js";
import { assertSupplierInClinic } from "./supplier.service.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";

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

/**
 * Receive a new batch (приход).
 *
 * @param {object} input
 * @param {string} input.drugItemId
 * @param {Date|string} input.expiryDate      REQUIRED
 * @param {number} input.amount               REQUIRED, > 0
 * @param {"pack"|"base"} [input.amountUnit]  default "pack" (× unitsPerPack)
 * @param {string} [input.batchNo]
 * @param {number} [input.unitCost]           per baseUnit
 * @param {string} [input.supplierId]
 * @param {Date|string} [input.receivedAt]
 * @param {string} [input.note]
 * @returns {Promise<object>}  the created batch
 */
export async function receiveBatch(input = {}) {
  const clinicId = requireClinicId();

  const {
    drugItemId,
    expiryDate,
    amount,
    amountUnit = "pack",
    batchNo = "",
    unitCost = 0,
    supplierId = null,
    receivedAt,
    note = "",
  } = input;

  if (!drugItemId) throw httpError("drugItemId required", 400);
  if (!expiryDate)
    throw httpError("expiryDate required", 400, "EXPIRY_REQUIRED");

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw httpError("amount must be > 0", 400, "BAD_AMOUNT");
  }

  // Drug must exist in THIS clinic and be active.
  const drug = await DrugItem.findOne({ _id: drugItemId, clinicId }).lean();
  if (!drug) throw httpError("Drug item not found", 404, "DRUG_ITEM_NOT_FOUND");
  if (drug.status === "archived") {
    throw httpError("Drug item is archived", 409, "DRUG_ARCHIVED");
  }

  const perPack = Math.max(1, Number(drug.unitsPerPack) || 1);
  const baseQty =
    amountUnit === "base" ? Math.round(amt) : Math.round(amt * perPack);

  if (baseQty <= 0)
    throw httpError("resolved quantity is 0", 400, "BAD_AMOUNT");

  // If a supplier is given, it must belong to THIS clinic (cross-clinic guard).
  if (supplierId) {
    await assertSupplierInClinic(supplierId);
  }

  const batch = await DrugBatch.create({
    clinicId,
    drugItemId,
    batchNo,
    expiryDate: new Date(expiryDate),
    quantity: baseQty,
    initialQuantity: baseQty,
    unitCost: Math.max(0, Number(unitCost) || 0),
    supplierId: supplierId || null,
    receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
    status: "active",
    note,
  });

  return batch.toObject();
}

/**
 * Current dispensable stock of a drug = Σ quantity of ACTIVE, non-expired
 * batches. Computed with find + reduce (plugins stay in effect).
 *
 * @param {string} drugItemId
 * @returns {Promise<{drugItemId:string, stock:number, batchCount:number,
 *   nearestExpiry: Date|null}>}
 */
export async function getStock(drugItemId) {
  const clinicId = requireClinicId();
  if (!drugItemId) throw httpError("drugItemId required", 400);

  const now = new Date();
  const batches = await DrugBatch.find({
    clinicId,
    drugItemId,
    status: "active",
    expiryDate: { $gt: now },
  })
    .select("quantity expiryDate")
    .sort({ expiryDate: 1 })
    .lean();

  const stock = batches.reduce((sum, b) => sum + (b.quantity || 0), 0);

  return {
    drugItemId: String(drugItemId),
    stock,
    batchCount: batches.length,
    nearestExpiry: batches.length ? batches[0].expiryDate : null,
  };
}

/**
 * Consume `qty` (baseUnit) from a drug's batches, soonest-expiring first
 * (FEFO). Adjusts batch quantities and marks depleted ones. Uses optimistic
 * locking (guard on the batch's current quantity) so two concurrent dispenses
 * can't oversell — on conflict it throws STOCK_CONFLICT for the caller to retry.
 *
 * Does NOT log — returns the allocation for the dispense service to persist.
 *
 * @param {string} drugItemId
 * @param {number} qty  baseUnit, > 0
 * @param {object} [opts]
 * @param {import("mongoose").ClientSession} [opts.session]  run inside a txn
 * @returns {Promise<{drugItemId:string, consumed:number,
 *   allocation: Array<{batchId:string, batchNo:string, expiryDate:Date,
 *   taken:number, remainingAfter:number}>}>}
 */
export async function consumeFEFO(drugItemId, qty, opts = {}) {
  const clinicId = requireClinicId();
  if (!drugItemId) throw httpError("drugItemId required", 400);

  const session = opts.session || undefined;

  const need = Number(qty);
  if (!Number.isFinite(need) || need <= 0) {
    throw httpError("qty must be > 0", 400, "BAD_QTY");
  }

  const now = new Date();
  const batches = await DrugBatch.find({
    clinicId,
    drugItemId,
    status: "active",
    expiryDate: { $gt: now },
  })
    .sort({ expiryDate: 1, receivedAt: 1 })
    .session(session)
    .lean();

  const available = batches.reduce((s, b) => s + (b.quantity || 0), 0);
  if (available < need) {
    throw httpError(
      `Insufficient stock: need ${need}, have ${available}`,
      409,
      "INSUFFICIENT_STOCK",
    );
  }

  // Plan the allocation in memory (FEFO).
  let remaining = need;
  const plan = [];
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity, remaining);
    if (take <= 0) continue;
    plan.push({
      batchId: b._id,
      batchNo: b.batchNo || "",
      expiryDate: b.expiryDate,
      prevQty: b.quantity,
      taken: take,
      remainingAfter: b.quantity - take,
    });
    remaining -= take;
  }

  // Apply with optimistic guard on prevQty. If a concurrent write changed the
  // quantity, matchedCount will be 0 → conflict, abort. (No multi-doc rollback
  // here; the dispense service should wrap this in a transaction/session when
  // it also writes DispenseLog.)
  const allocation = [];
  for (const p of plan) {
    const newQty = p.remainingAfter;
    const res = await DrugBatch.updateOne(
      { _id: p.batchId, clinicId, quantity: p.prevQty, status: "active" },
      {
        $set: {
          quantity: newQty,
          status: newQty === 0 ? "depleted" : "active",
        },
      },
      { session },
    );
    if (!res.matchedCount) {
      throw httpError(
        "Stock changed during dispense, retry",
        409,
        "STOCK_CONFLICT",
      );
    }
    allocation.push({
      batchId: String(p.batchId),
      batchNo: p.batchNo,
      expiryDate: p.expiryDate,
      taken: p.taken,
      remainingAfter: newQty,
    });
  }

  return { drugItemId: String(drugItemId), consumed: need, allocation };
}

/**
 * List batches of a drug (read). Newest receipt first.
 * @param {string} drugItemId
 * @param {object} [opts]
 * @param {boolean} [opts.includeInactive]  include depleted/expired/written_off
 * @returns {Promise<object[]>}
 */
export async function listBatches(drugItemId, opts = {}) {
  const clinicId = requireClinicId();
  if (!drugItemId) throw httpError("drugItemId required", 400);

  const filter = { clinicId, drugItemId };
  if (!opts.includeInactive) filter.status = "active";

  return DrugBatch.find(filter).sort({ receivedAt: -1 }).lean();
}

/**
 * Clinic-wide "expires within N days" report (active batches with stock).
 * @param {number} [days=30]
 * @returns {Promise<object[]>}  soonest-expiring first
 */
export async function expiringSoon(days = 30) {
  const clinicId = requireClinicId();

  const now = new Date();
  const until = new Date(now.getTime() + Math.max(1, days) * 86400000);

  return DrugBatch.find({
    clinicId,
    status: "active",
    quantity: { $gt: 0 },
    expiryDate: { $gt: now, $lte: until },
  })
    .sort({ expiryDate: 1 })
    .populate("drugItemId", "name form strength baseUnit")
    .lean();
}
