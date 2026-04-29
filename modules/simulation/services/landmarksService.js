// server/modules/simulation/services/landmarksService.js
//
// Сервисный слой landmarks.
// S.7.7+ — serializePlan строит proxy URL для photo.url (как и в
// simulationPlan.service.js). Без этого после save landmarks клиент
// получил бы план с CDN URL → перезаписал в Redux → 30 минут ожидания.

import mongoose from "mongoose";
import SimulationPlan from "../models/SimulationPlan.js";
import {
  validateLandmarks,
  validateLandmarksMeta,
} from "../validators/landmarksValidator.js";

function makeError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

/**
 * S.7.7+ — Строит proxy URL из r2Key. Должен совпадать с реализацией
 * в simulationPlan.service.js. Не выносим в общий модуль чтобы сохранить
 * self-contained принцип модуля simulation.
 */
function buildPhotoProxyUrl(r2Key) {
  if (!r2Key) return null;
  return `/api/simulation/photos/proxy?key=${encodeURIComponent(r2Key)}`;
}

/* ─────────────────────────────────────────────────────────────────────
   Локальная сериализация плана для ответа клиенту.
   labelEncrypted и patientRefEncrypted остаются зашифрованными в shape,
   normalizePlan на клиенте этого ожидает.
   ───────────────────────────────────────────────────────────────────── */
function serializePlan(planDoc) {
  if (!planDoc) return null;
  const obj = planDoc.toObject ? planDoc.toObject() : planDoc;

  return {
    id: String(obj._id),
    doctorId: String(obj.doctorId),
    labelEncrypted: obj.labelEncrypted,
    patientRefEncrypted: obj.patientRefEncrypted ?? null,
    photo: obj.photo
      ? {
          // r2Key оставляем для совместимости с возможными внутренними
          // потребителями этого DTO, но клиент использует только url
          r2Key: obj.photo.r2Key,
          // S.7.7+ — proxy URL
          url: buildPhotoProxyUrl(obj.photo.r2Key),
          width: obj.photo.width,
          height: obj.photo.height,
          size: obj.photo.size,
          mimeType: obj.photo.mimeType,
          uploadedAt: obj.photo.uploadedAt,
        }
      : null,
    controlPoints: Array.isArray(obj.controlPoints) ? obj.controlPoints : [],
    landmarks: Array.isArray(obj.landmarks) ? obj.landmarks : [],
    landmarksMeta: obj.landmarksMeta || {
      detectedAt: null,
      modelVersion: null,
      imageWidth: null,
      imageHeight: null,
      pointsCount: 0,
    },
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

/**
 * Сохраняет landmarks для плана.
 */
export async function saveLandmarks({ planId, userId, landmarks, meta }) {
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    throw makeError("invalid_id", "invalid plan id");
  }

  let cleanLandmarks;
  let cleanMeta;
  try {
    cleanLandmarks = validateLandmarks(landmarks);
    cleanMeta = validateLandmarksMeta(meta);
  } catch (err) {
    throw makeError("invalid_payload", err.message);
  }

  const plan =
    await SimulationPlan.findById(planId).select("doctorId deletedAt");
  if (!plan || plan.deletedAt) {
    throw makeError("not_found", "plan not found");
  }
  if (String(plan.doctorId) !== String(userId)) {
    throw makeError("forbidden", "not the owner of this plan");
  }

  const updated = await SimulationPlan.findByIdAndUpdate(
    planId,
    {
      $set: {
        landmarks: cleanLandmarks,
        landmarksMeta: {
          detectedAt: cleanLandmarks.length > 0 ? new Date() : null,
          modelVersion: cleanMeta.modelVersion,
          imageWidth: cleanMeta.imageWidth,
          imageHeight: cleanMeta.imageHeight,
          pointsCount: cleanLandmarks.length,
        },
      },
    },
    { new: true, runValidators: true },
  );

  if (!updated) {
    throw makeError("not_found", "plan disappeared during update");
  }

  return serializePlan(updated);
}

/**
 * Очищает landmarks.
 */
export async function clearLandmarks({ planId, userId }) {
  return saveLandmarks({
    planId,
    userId,
    landmarks: [],
    meta: {},
  });
}
