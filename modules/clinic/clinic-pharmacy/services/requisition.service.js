// server/modules/clinic/clinic-pharmacy/services/requisition.service.js
//
// Business logic for stock requisitions (заявки отделений в аптеку). Every
// operation is clinic-scoped via getCurrentClinicId(). The creating nurse is
// taken from getCurrentMembershipId() — never trusted from the payload.
//
// This service owns the nurse-side lifecycle:
//   create → submit → (cancel)   and   draft editing.
// The pharmacist-side fulfilment (bumping qtyDispensed, flipping status to
// partially_dispensed / dispensed, FEFO batch consumption, DispenseLog + audit)
// lives in the dispense service (п.4) — NOT here.
//
// Quantities are baseUnit (see requisition.model.js header).

import Requisition from "../models/requisition.model.js";
import DrugItem from "../models/drugItem.model.js";
import {
  getCurrentClinicId,
  getCurrentMembershipId,
} from "../../../../common/context/tenantContext.js";

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

/**
 * Validate incoming line items against the clinic's ACTIVE catalog and merge
 * duplicate drugItemId lines (summing quantities). Returns clean items.
 * @param {Array} rawItems
 * @param {string} clinicId
 * @returns {Promise<Array<{drugItemId, qtyRequested, note}>>}
 */
async function validateAndMergeItems(rawItems, clinicId) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw httpError("At least one item is required", 400, "NO_ITEMS");
  }

  // Merge duplicates by drugItemId.
  const merged = new Map();
  for (const raw of rawItems) {
    const drugItemId = raw?.drugItemId ? String(raw.drugItemId) : "";
    const qty = Number(raw?.qtyRequested);
    if (!drugItemId) throw httpError("item.drugItemId required", 400);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw httpError("item.qtyRequested must be > 0", 400, "BAD_QTY");
    }
    const prev = merged.get(drugItemId);
    if (prev) {
      prev.qtyRequested += Math.round(qty);
      if (raw.note && !prev.note) prev.note = String(raw.note).slice(0, 300);
    } else {
      merged.set(drugItemId, {
        drugItemId,
        qtyRequested: Math.round(qty),
        note: raw.note ? String(raw.note).slice(0, 300) : "",
      });
    }
  }

  const ids = Array.from(merged.keys());

  // Every drug must exist in THIS clinic and be active.
  const found = await DrugItem.find({
    _id: { $in: ids },
    clinicId,
    status: "active",
  })
    .select("_id")
    .lean();

  if (found.length !== ids.length) {
    const foundSet = new Set(found.map((d) => String(d._id)));
    const missing = ids.filter((id) => !foundSet.has(id));
    throw httpError(
      `Unknown or archived drug item(s): ${missing.join(", ")}`,
      400,
      "BAD_DRUG_ITEM",
    );
  }

  return Array.from(merged.values());
}

/**
 * Create a requisition (nurse). submit:true sends it straight to pharmacy.
 * @param {object} input
 * @param {string} input.departmentId  REQUIRED
 * @param {Array}  input.items         REQUIRED [{ drugItemId, qtyRequested, note }]
 * @param {"normal"|"urgent"} [input.priority]
 * @param {string} [input.note]
 * @param {boolean} [input.submit]     default false (stays draft)
 * @returns {Promise<object>}
 */
export async function createRequisition(input = {}) {
  const clinicId = requireClinicId();
  const membershipId = requireMembershipId();

  const { departmentId, items, priority = "normal", note = "", submit } = input;

  if (!departmentId) {
    throw httpError("departmentId required", 400, "DEPARTMENT_REQUIRED");
  }

  const cleanItems = await validateAndMergeItems(items, clinicId);
  const willSubmit = submit === true;

  const created = await Requisition.create({
    clinicId,
    departmentId,
    requestedByMembershipId: membershipId,
    priority: priority === "urgent" ? "urgent" : "normal",
    note: note ? String(note).slice(0, 1000) : "",
    items: cleanItems,
    status: willSubmit ? "submitted" : "draft",
    submittedAt: willSubmit ? new Date() : null,
  });

  return created.toObject();
}

/**
 * Update a DRAFT requisition (nurse). Only allowed while status === "draft".
 * @param {string} id
 * @param {object} patch  { departmentId?, items?, priority?, note? }
 * @returns {Promise<object>}
 */
export async function updateDraft(id, patch = {}) {
  const clinicId = requireClinicId();
  if (!id) throw httpError("id required", 400);

  const req = await Requisition.findOne({ _id: id, clinicId });
  if (!req) throw httpError("Requisition not found", 404, "REQ_NOT_FOUND");
  if (req.status !== "draft") {
    throw httpError("Only draft requisitions can be edited", 409, "NOT_DRAFT");
  }

  if (patch.departmentId !== undefined) {
    if (!patch.departmentId) {
      throw httpError("departmentId cannot be empty", 400);
    }
    req.departmentId = patch.departmentId;
  }
  if (patch.priority !== undefined) {
    req.priority = patch.priority === "urgent" ? "urgent" : "normal";
  }
  if (patch.note !== undefined) {
    req.note = patch.note ? String(patch.note).slice(0, 1000) : "";
  }
  if (patch.items !== undefined) {
    req.items = await validateAndMergeItems(patch.items, clinicId);
  }

  await req.save();
  return req.toObject();
}

/**
 * Submit a draft → submitted (nurse).
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function submitRequisition(id) {
  const clinicId = requireClinicId();
  if (!id) throw httpError("id required", 400);

  const req = await Requisition.findOne({ _id: id, clinicId });
  if (!req) throw httpError("Requisition not found", 404, "REQ_NOT_FOUND");
  if (req.status !== "draft") {
    throw httpError(
      "Only draft requisitions can be submitted",
      409,
      "NOT_DRAFT",
    );
  }
  if (!req.items || req.items.length === 0) {
    throw httpError("Cannot submit an empty requisition", 400, "NO_ITEMS");
  }

  req.status = "submitted";
  req.submittedAt = new Date();
  await req.save();
  return req.toObject();
}

/**
 * Cancel a requisition (nurse withdrawal). Allowed only before anything has
 * been dispensed — draft or submitted with no fulfilled quantity.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function cancelRequisition(id) {
  const clinicId = requireClinicId();
  if (!id) throw httpError("id required", 400);

  const req = await Requisition.findOne({ _id: id, clinicId });
  if (!req) throw httpError("Requisition not found", 404, "REQ_NOT_FOUND");

  const anyDispensed = (req.items || []).some(
    (it) => (it.qtyDispensed || 0) > 0,
  );
  if (anyDispensed || !["draft", "submitted"].includes(req.status)) {
    throw httpError(
      "Cannot cancel a requisition that is already being fulfilled",
      409,
      "NOT_CANCELLABLE",
    );
  }

  req.status = "cancelled";
  await req.save();
  return req.toObject();
}

/**
 * Fetch one requisition (clinic-scoped) with drug + department populated.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function getRequisitionById(id) {
  const clinicId = requireClinicId();
  if (!id) throw httpError("id required", 400);

  const req = await Requisition.findOne({ _id: id, clinicId })
    .populate("items.drugItemId", "name form strength baseUnit isControlled")
    .populate("departmentId", "name")
    .lean();

  if (!req) throw httpError("Requisition not found", 404, "REQ_NOT_FOUND");
  return req;
}

/**
 * List requisitions (clinic-scoped) with flexible filters. Callers compose the
 * view they need:
 *   • pharmacist queue → { status: ["submitted","partially_dispensed"] }
 *   • nurse "mine"     → { mine: true }
 *   • department view  → { departmentId }
 *
 * @param {object} [opts]
 * @param {string|string[]} [opts.status]
 * @param {string} [opts.departmentId]
 * @param {boolean} [opts.mine]        restrict to current membership's own
 * @param {number} [opts.limit]        default 100, cap 300
 * @param {number} [opts.skip]
 * @returns {Promise<{requisitions: object[], total: number}>}
 */
export async function listRequisitions(opts = {}) {
  const clinicId = requireClinicId();
  const { status, departmentId, mine, limit = 100, skip = 0 } = opts;

  const filter = { clinicId };

  if (status) {
    let statuses = status;
    if (typeof status === "string") {
      statuses = status.includes(",") ? status.split(",") : [status];
    }
    if (Array.isArray(statuses)) {
      statuses = statuses.map((s) => String(s).trim()).filter(Boolean);
      if (statuses.length === 1) filter.status = statuses[0];
      else if (statuses.length > 1) filter.status = { $in: statuses };
    }
  }

  if (departmentId) filter.departmentId = departmentId;
  if (mine) filter.requestedByMembershipId = requireMembershipId();

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const safeSkip = Math.max(Number(skip) || 0, 0);

  const [requisitions, total] = await Promise.all([
    Requisition.find(filter)
      .sort({ submittedAt: -1, createdAt: -1 })
      .skip(safeSkip)
      .limit(safeLimit)
      .populate("items.drugItemId", "name form strength baseUnit isControlled")
      .populate("departmentId", "name")
      .lean(),
    Requisition.countDocuments(filter),
  ]);

  return { requisitions, total };
}
