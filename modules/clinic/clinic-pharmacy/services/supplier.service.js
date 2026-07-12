// server/modules/clinic/clinic-pharmacy/services/supplier.service.js
//
// Business logic for pharmacy suppliers (поставщики). Every operation is
// scoped to the current clinic via getCurrentClinicId(). No hard delete —
// archiveSupplier() flips status to "archived" so historical batch references
// stay valid. Same conventions as drugItem.service.js.

import Supplier from "../models/supplier.model.js";
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

function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WRITABLE_FIELDS = [
  "name",
  "contactPerson",
  "phone",
  "email",
  "address",
  "taxId",
  "note",
];

function pickWritable(input = {}) {
  const out = {};
  for (const key of WRITABLE_FIELDS) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

/**
 * List suppliers for the current clinic.
 * @param {object} [opts]
 * @param {string} [opts.search]           substring on name/contact/taxId
 * @param {boolean}[opts.includeArchived]  default false
 * @param {number} [opts.limit]            default 200, cap 500
 * @param {number} [opts.skip]
 * @returns {Promise<{items: object[], total: number}>}
 */
export async function listSuppliers(opts = {}) {
  const clinicId = requireClinicId();
  const { search, includeArchived = false, limit = 200, skip = 0 } = opts;

  const filter = { clinicId };
  if (!includeArchived) filter.status = "active";

  if (search && String(search).trim()) {
    const rx = new RegExp(escapeRegex(String(search).trim()), "i");
    filter.$or = [{ name: rx }, { contactPerson: rx }, { taxId: rx }];
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const safeSkip = Math.max(Number(skip) || 0, 0);

  const [items, total] = await Promise.all([
    Supplier.find(filter)
      .sort({ name: 1 })
      .skip(safeSkip)
      .limit(safeLimit)
      .lean(),
    Supplier.countDocuments(filter),
  ]);

  return { items, total };
}

/**
 * Fetch a single supplier by id (clinic-scoped).
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function getSupplierById(id) {
  const clinicId = requireClinicId();
  if (!id) throw httpError("id required", 400);

  const supplier = await Supplier.findOne({ _id: id, clinicId }).lean();
  if (!supplier)
    throw httpError("Supplier not found", 404, "SUPPLIER_NOT_FOUND");
  return supplier;
}

/**
 * Assert a supplier exists & is active in the current clinic. Used by
 * receiveBatch before attaching supplierId to a batch. Returns the clinicId
 * so callers can reuse it. Throws on mismatch (cross-clinic protection).
 * @param {string} supplierId
 */
export async function assertSupplierInClinic(supplierId) {
  const clinicId = requireClinicId();
  const exists = await Supplier.exists({
    _id: supplierId,
    clinicId,
    status: "active",
  });
  if (!exists) {
    throw httpError("Unknown or archived supplier", 400, "BAD_SUPPLIER");
  }
  return true;
}

/**
 * Create a supplier for the current clinic.
 * @param {object} data
 * @returns {Promise<object>}
 */
export async function createSupplier(data = {}) {
  const clinicId = requireClinicId();

  const payload = pickWritable(data);
  if (!payload.name || !String(payload.name).trim()) {
    throw httpError("name required", 400, "NAME_REQUIRED");
  }

  const created = await Supplier.create({
    ...payload,
    clinicId,
    status: "active",
  });
  return created.toObject();
}

/**
 * Patch a supplier (clinic-scoped). Only whitelisted fields apply.
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<object>}
 */
export async function updateSupplier(id, patch = {}) {
  const clinicId = requireClinicId();
  if (!id) throw httpError("id required", 400);

  const updates = pickWritable(patch);
  if (Object.keys(updates).length === 0) {
    throw httpError("No writable fields in payload", 400, "EMPTY_PATCH");
  }
  if (updates.name !== undefined && !String(updates.name).trim()) {
    throw httpError("name cannot be empty", 400, "NAME_REQUIRED");
  }

  const updated = await Supplier.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: updates },
    { new: true, runValidators: true },
  ).lean();

  if (!updated)
    throw httpError("Supplier not found", 404, "SUPPLIER_NOT_FOUND");
  return updated;
}

/**
 * Archive a supplier (soft delete): status -> "archived". Idempotent.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function archiveSupplier(id) {
  const clinicId = requireClinicId();
  if (!id) throw httpError("id required", 400);

  const archived = await Supplier.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: { status: "archived" } },
    { new: true },
  ).lean();

  if (!archived)
    throw httpError("Supplier not found", 404, "SUPPLIER_NOT_FOUND");
  return archived;
}

/**
 * Restore an archived supplier: status -> "active".
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function restoreSupplier(id) {
  const clinicId = requireClinicId();
  if (!id) throw httpError("id required", 400);

  const restored = await Supplier.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: { status: "active" } },
    { new: true },
  ).lean();

  if (!restored)
    throw httpError("Supplier not found", 404, "SUPPLIER_NOT_FOUND");
  return restored;
}
