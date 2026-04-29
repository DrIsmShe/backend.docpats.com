// server/modules/simulation/services/simulationPlan.service.js
import mongoose from "mongoose";
import SimulationPlan from "../models/SimulationPlan.js";
import { encrypt, safeDecrypt } from "./encryption.service.js";
import { deletePhotoObject } from "./upload.service.js";

/* ──────────────────────────────────────────────────────────────────────────
   Сервисный слой для SimulationPlan.

   S.7.7+: photo.url теперь backend proxy URL (/api/simulation/photos/proxy?key=...)
   вместо прямого CDN URL (media.docpats.com). Решает проблему Cloudflare
   propagation 5-30 минут на свежезагруженных файлах.

   r2Key хранится в БД и используется:
     • для строительства proxy URL через buildPhotoProxyUrl()
     • для surgery worker (внутреннее использование)
     • для cleanup при delete/dedup
   ────────────────────────────────────────────────────────────────────────── */

/**
 * S.7.7+ — Строим proxy URL для фото из r2Key.
 * Frontend получает этот URL и обращается к backend, минуя Cloudflare CDN.
 */
function buildPhotoProxyUrl(r2Key) {
  if (!r2Key) return null;
  return `/api/simulation/photos/proxy?key=${encodeURIComponent(r2Key)}`;
}

/* ──────────────────────────────────────────────────────────────────────────
   DTO helper
   ────────────────────────────────────────────────────────────────────────── */
function toPlanDTO(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;

  return {
    id: String(o._id),
    doctorId: String(o.doctorId),
    label: safeDecrypt(o.labelEncrypted, ""),
    patientRef: safeDecrypt(o.patientRefEncrypted, ""),
    photo: o.photo
      ? {
          // S.7.7+ — отдаём proxy URL, не CDN URL
          url: buildPhotoProxyUrl(o.photo.r2Key),
          width: o.photo.width,
          height: o.photo.height,
          mimeType: o.photo.mimeType,
          uploadedAt: o.photo.uploadedAt,
          // r2Key НЕ отдаём клиенту — внутренний идентификатор.
        }
      : null,
    controlPoints: o.controlPoints || [],
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt || null,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   CREATE
   ────────────────────────────────────────────────────────────────────────── */
export async function createPlan(
  doctorId,
  { label, patientRef, photo, controlPoints },
) {
  const doc = await SimulationPlan.create({
    doctorId,
    labelEncrypted: encrypt(label),
    patientRefEncrypted: encrypt(patientRef || null),
    photo,
    controlPoints: controlPoints || [],
  });

  return toPlanDTO(doc);
}

/* ──────────────────────────────────────────────────────────────────────────
   LIST
   ────────────────────────────────────────────────────────────────────────── */
export async function listPlans(
  doctorId,
  { limit = 30, cursor, includeDeleted = false } = {},
) {
  const query = { doctorId };

  if (!includeDeleted) {
    query.deletedAt = null;
  }

  if (cursor) {
    query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const docs = await SimulationPlan.find(query)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;

  return {
    items: page.map(toPlanDTO),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    hasMore,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   GET ById
   ────────────────────────────────────────────────────────────────────────── */
export async function getPlanById(
  doctorId,
  planId,
  { includeDeleted = false } = {},
) {
  if (!mongoose.isValidObjectId(planId)) return null;

  const query = {
    _id: planId,
    doctorId,
  };

  if (!includeDeleted) {
    query.deletedAt = null;
  }

  const doc = await SimulationPlan.findOne(query);
  return toPlanDTO(doc);
}

/* ──────────────────────────────────────────────────────────────────────────
   UPDATE
   ────────────────────────────────────────────────────────────────────────── */
export async function updatePlan(doctorId, planId, patch) {
  if (!mongoose.isValidObjectId(planId)) return null;

  const update = {};

  if (patch.label !== undefined) {
    update.labelEncrypted = encrypt(patch.label);
  }
  if (patch.patientRef !== undefined) {
    update.patientRefEncrypted = encrypt(patch.patientRef || null);
  }
  if (patch.controlPoints !== undefined) {
    update.controlPoints = patch.controlPoints;
  }

  if (Object.keys(update).length === 0) {
    return getPlanById(doctorId, planId);
  }

  const doc = await SimulationPlan.findOneAndUpdate(
    { _id: planId, doctorId, deletedAt: null },
    { $set: update },
    { new: true, runValidators: true },
  );

  return toPlanDTO(doc);
}

/* ──────────────────────────────────────────────────────────────────────────
   DELETE
   ────────────────────────────────────────────────────────────────────────── */
export async function deletePlan(doctorId, planId) {
  if (!mongoose.isValidObjectId(planId)) return null;

  const doc = await SimulationPlan.findOneAndUpdate(
    { _id: planId, doctorId },
    { $set: { deletedAt: new Date() } },
    { new: true },
  );

  if (!doc) return null;

  if (doc.photo?.r2Key) {
    const shared = await isPhotoSharedWithOtherPlans(
      doctorId,
      doc.photo.r2Key,
      doc._id,
    );
    if (!shared) {
      await deletePhotoObject(doc.photo.r2Key);
    }
  }

  return toPlanDTO(doc);
}

/* ──────────────────────────────────────────────────────────────────────────
   DUPLICATE
   ────────────────────────────────────────────────────────────────────────── */
export async function duplicatePlan(doctorId, planId, { newLabel } = {}) {
  const original = await SimulationPlan.findOne({
    _id: planId,
    doctorId,
    deletedAt: null,
  });

  if (!original) return null;

  const label =
    newLabel || `${safeDecrypt(original.labelEncrypted, "Plan")} (copy)`;

  const doc = await SimulationPlan.create({
    doctorId,
    labelEncrypted: encrypt(label),
    patientRefEncrypted: original.patientRefEncrypted,
    photo: original.photo,
    controlPoints: original.controlPoints,
  });

  return toPlanDTO(doc);
}

/* ──────────────────────────────────────────────────────────────────────────
   isPhotoSharedWithOtherPlans
   ────────────────────────────────────────────────────────────────────────── */
export async function isPhotoSharedWithOtherPlans(
  doctorId,
  r2Key,
  excludePlanId,
) {
  const count = await SimulationPlan.countDocuments({
    doctorId,
    "photo.r2Key": r2Key,
    _id: { $ne: excludePlanId },
    deletedAt: null,
  });
  return count > 0;
}
