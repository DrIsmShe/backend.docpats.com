// server/modules/clinic/clinic-pharmacy/services/drugItem.service.js
//
// Business logic for the drug formulary (номенклатура). Every operation is
// scoped to the CURRENT clinic via getCurrentClinicId() — a caller can never
// read or mutate another clinic's catalog, because clinicId is baked into
// every query/filter (same manual tenant-scoping the other clinic-* modules
// use; DrugItem has no tenant plugin by design).
//
// Deletion policy: NO hard delete. archiveDrugItem() flips status to
// "archived" so historical batches/dispenses keep a valid reference. The
// controller still exposes DELETE, but it maps to archive.
//
// NOTE: no audit here on purpose — a drug formulary is NON-PHI reference data.
// Audit (recordActionAsync) belongs on DISPENSE and on controlled-substance
// movements, added when DispenseLog lands.

import DrugItem from "../models/drugItem.model.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";

// ── small error helper ─────────────────────────────────────
// errorHandler reads .status / .statusCode; set both to be safe.
function httpError(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  if (code) err.code = code;
  return err;
}

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) {
    throw httpError("No clinic context", 401, "NO_CLINIC_CONTEXT");
  }
  return clinicId;
}

// Escape user input before using it inside a RegExp.
function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whitelist of fields a client may set/patch. Everything else (clinicId,
// timestamps, status) is controlled by the service, never by the payload.
const WRITABLE_FIELDS = [
  "name",
  "inn",
  "form",
  "strength",
  "baseUnit",
  "packUnit",
  "unitsPerPack",
  "category",
  "manufacturer",
  "sku",
  "isControlled",
  "minStock",
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
 * List catalog items for the current clinic.
 *
 * @param {object} [opts]
 * @param {string} [opts.search]          substring match on name/INN
 * @param {string} [opts.category]        exact category filter
 * @param {boolean}[opts.isControlled]    filter controlled-only
 * @param {boolean}[opts.includeArchived] include archived (default false)
 * @param {number} [opts.limit]           default 200, hard cap 500
 * @param {number} [opts.skip]            pagination offset
 * @returns {Promise<{items: object[], total: number}>}
 */
export async function listDrugItems(opts = {}) {
  const clinicId = requireClinicId();

  const {
    search,
    category,
    isControlled,
    includeArchived = false,
    limit = 200,
    skip = 0,
  } = opts;

  const filter = { clinicId };

  if (!includeArchived) filter.status = "active";
  if (category) filter.category = category;
  if (typeof isControlled === "boolean") filter.isControlled = isControlled;

  if (search && String(search).trim()) {
    const rx = new RegExp(escapeRegex(String(search).trim()), "i");
    filter.$or = [{ name: rx }, { inn: rx }, { sku: rx }];
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const safeSkip = Math.max(Number(skip) || 0, 0);

  const [items, total] = await Promise.all([
    DrugItem.find(filter)
      .sort({ name: 1 })
      .skip(safeSkip)
      .limit(safeLimit)
      .lean(),
    DrugItem.countDocuments(filter),
  ]);

  return { items, total };
}

/**
 * Fetch a single item by id, scoped to the current clinic.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function getDrugItemById(id) {
  const clinicId = requireClinicId();
  if (!id) throw httpError("id required", 400);

  const item = await DrugItem.findOne({ _id: id, clinicId }).lean();
  if (!item) throw httpError("Drug item not found", 404, "DRUG_ITEM_NOT_FOUND");
  return item;
}

/**
 * Create a new catalog item for the current clinic.
 * @param {object} data
 * @returns {Promise<object>}
 */
export async function createDrugItem(data = {}) {
  const clinicId = requireClinicId();

  const payload = pickWritable(data);
  if (!payload.name || !String(payload.name).trim()) {
    throw httpError("name required", 400, "NAME_REQUIRED");
  }

  // clinicId + status are set by the service, not the caller.
  const created = await DrugItem.create({
    ...payload,
    clinicId,
    status: "active",
  });

  return created.toObject();
}

/**
 * Patch an existing item (clinic-scoped). Only whitelisted fields apply.
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<object>}
 */
export async function updateDrugItem(id, patch = {}) {
  const clinicId = requireClinicId();
  if (!id) throw httpError("id required", 400);

  const updates = pickWritable(patch);
  if (Object.keys(updates).length === 0) {
    throw httpError("No writable fields in payload", 400, "EMPTY_PATCH");
  }
  if (updates.name !== undefined && !String(updates.name).trim()) {
    throw httpError("name cannot be empty", 400, "NAME_REQUIRED");
  }

  const updated = await DrugItem.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: updates },
    { new: true, runValidators: true },
  ).lean();

  if (!updated) {
    throw httpError("Drug item not found", 404, "DRUG_ITEM_NOT_FOUND");
  }
  return updated;
}

/**
 * Archive an item (soft delete): status -> "archived". Idempotent.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function archiveDrugItem(id) {
  const clinicId = requireClinicId();
  if (!id) throw httpError("id required", 400);

  const archived = await DrugItem.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: { status: "archived" } },
    { new: true },
  ).lean();

  if (!archived) {
    throw httpError("Drug item not found", 404, "DRUG_ITEM_NOT_FOUND");
  }
  return archived;
}

/**
 * Restore an archived item: status -> "active".
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function restoreDrugItem(id) {
  const clinicId = requireClinicId();
  if (!id) throw httpError("id required", 400);

  const restored = await DrugItem.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: { status: "active" } },
    { new: true },
  ).lean();

  if (!restored) {
    throw httpError("Drug item not found", 404, "DRUG_ITEM_NOT_FOUND");
  }
  return restored;
}
