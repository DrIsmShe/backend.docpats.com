// server/modules/clinic/clinic-gallery/controllers/clinicGalleryItem.controller.js

import * as service from "../services/clinicGalleryItem.service.js";
import {
  createGalleryItemSchema,
  updateGalleryItemSchema,
  reorderGallerySchema,
} from "../validators/clinicGalleryItem.schemas.js";
import { ForbiddenError } from "../../../../common/utils/errors.js";
import { can } from "../../../../common/auth/can.js";

function assertCanWrite() {
  if (!can("clinic", "write")) {
    throw new ForbiddenError("clinic.write permission required");
  }
}

function toItem(it) {
  return {
    id: String(it._id),
    pageId: String(it.pageId),
    image: it.image,
    caption: it.caption || "",
    description: it.description || "",
    order: it.order ?? 0,
  };
}

/** GET /api/v1/clinic/gallery?pageId= */
export async function listGalleryItems(req, res, next) {
  try {
    const items = await service.listGalleryItems({ pageId: req.query.pageId });
    res.json({ items: items.map(toItem) });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/clinic/gallery */
export async function createGalleryItem(req, res, next) {
  try {
    assertCanWrite();
    const data = createGalleryItemSchema.parse(req.body);
    const item = await service.createGalleryItem(data);
    res.status(201).json({ item: toItem(item) });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/clinic/gallery/:id */
export async function updateGalleryItem(req, res, next) {
  try {
    assertCanWrite();
    const updates = updateGalleryItemSchema.parse(req.body);
    const item = await service.updateGalleryItem(req.params.id, updates);
    res.json({ item: toItem(item) });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/clinic/gallery/reorder */
export async function reorderGallery(req, res, next) {
  try {
    assertCanWrite();
    const { items } = reorderGallerySchema.parse(req.body);
    const result = await service.reorderGallery(items);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/v1/clinic/gallery/:id */
export async function deleteGalleryItem(req, res, next) {
  try {
    assertCanWrite();
    const result = await service.removeGalleryItem(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
