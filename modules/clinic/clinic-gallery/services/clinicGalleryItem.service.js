// server/modules/clinic/clinic-gallery/services/clinicGalleryItem.service.js

import ClinicGalleryItem from "../models/clinicGalleryItem.model.js";
import ClinicCustomPage from "../../clinic-pages/models/clinicCustomPage.model.js";
import {
  NotFoundError,
  ValidationError,
} from "../../../../common/utils/errors.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";

/** Список фото категории. filters: { pageId } */
export async function listGalleryItems(filters = {}) {
  const q = {};
  if (filters.pageId) q.pageId = filters.pageId;
  return ClinicGalleryItem.find(q).sort({ order: 1, createdAt: 1 }).lean();
}

export async function getGalleryItem(itemId) {
  const it = await ClinicGalleryItem.findById(itemId).lean();
  if (!it) throw new NotFoundError("ClinicGalleryItem");
  return it;
}

export async function createGalleryItem(data) {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ValidationError("No clinic context");

  // категория должна принадлежать этой клинике
  const page = await ClinicCustomPage.findOne({ _id: data.pageId, clinicId })
    .select("_id")
    .lean();
  if (!page) throw new ValidationError("Category page not found");

  const doc = await ClinicGalleryItem.create({ ...data, clinicId });
  return doc.toObject();
}

export async function updateGalleryItem(itemId, updates) {
  const it = await ClinicGalleryItem.findById(itemId);
  if (!it) throw new NotFoundError("ClinicGalleryItem");
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) it[k] = v;
  }
  await it.save();
  return it.toObject();
}

export async function reorderGallery(items = []) {
  const ops = items.map((x) => ({
    updateOne: { filter: { _id: x.id }, update: { $set: { order: x.order } } },
  }));
  if (ops.length) await ClinicGalleryItem.bulkWrite(ops);
  return { ok: true };
}

export async function removeGalleryItem(itemId) {
  const it = await ClinicGalleryItem.findById(itemId);
  if (!it) throw new NotFoundError("ClinicGalleryItem");
  await it.softDelete();
  return { id: String(it._id), deleted: true };
}
