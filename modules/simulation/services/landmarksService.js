// server/modules/simulation/services/landmarksService.js
//
// Сервисный слой landmarks.
// - Проверяет владение планом (doctorId === session.userId).
// - Атомарно обновляет landmarks + landmarksMeta.
// - Возвращает обновлённый план целиком, чтобы клиент мог напрямую
//   замержить ответ в state.simulation.current через normalizePlan.
//
// Сериализация плана выполняется локальной функцией serializePlan
// (нет внешней зависимости от common-сериализатора).

import mongoose from "mongoose";
import SimulationPlan from "../models/SimulationPlan.js";
import {
  validateLandmarks,
  validateLandmarksMeta,
} from "../validators/landmarksValidator.js";

/* ─────────────────────────────────────────────────────────────────────
   Helper для бросания типизированных ошибок.
   Контроллер маппит err.code → HTTP status.
   ───────────────────────────────────────────────────────────────────── */
function makeError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

/* ─────────────────────────────────────────────────────────────────────
   Локальная сериализация плана для ответа клиенту.

   ВАЖНО: labelEncrypted и patientRefEncrypted НЕ возвращаются в
   raw-виде — они зашифрованы (PHI). Если у тебя есть decrypt-логика
   в getPlan-контроллере, скопируй её сюда или вынеси общий serializer
   и замени эту функцию на импорт.

   Пока возвращаем только то, что клиенту реально нужно для editor'а
   после save/clear landmarks.
   ───────────────────────────────────────────────────────────────────── */
function serializePlan(planDoc) {
  if (!planDoc) return null;
  const obj = planDoc.toObject ? planDoc.toObject() : planDoc;

  return {
    id: String(obj._id),
    doctorId: String(obj.doctorId),
    // Зашифрованные поля прокидываем как есть — клиент их не использует
    // в editor'е после landmarks-операции, но они должны присутствовать
    // в shape, чтобы не сломать normalizePlan на клиенте.
    labelEncrypted: obj.labelEncrypted,
    patientRefEncrypted: obj.patientRefEncrypted ?? null,
    photo: obj.photo
      ? {
          r2Key: obj.photo.r2Key,
          url: obj.photo.url,
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
 *
 * @param {Object} args
 * @param {string} args.planId
 * @param {string} args.userId      — doctorId из сессии
 * @param {Array}  args.landmarks   — payload с клиента
 * @param {Object} args.meta        — { modelVersion, imageWidth, imageHeight }
 * @returns {Promise<Object>}       — сериализованный план
 *
 * @throws {Error & {code}} 'invalid_id' | 'invalid_payload' | 'not_found' | 'forbidden'
 */
export async function saveLandmarks({ planId, userId, landmarks, meta }) {
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    throw makeError("invalid_id", "invalid plan id");
  }

  // Валидация payload
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
    // race: план удалили между findById и findByIdAndUpdate
    throw makeError("not_found", "plan disappeared during update");
  }

  return serializePlan(updated);
}

/**
 * Очищает landmarks (например, при смене фото в плане).
 * Реализован как тонкая обёртка над saveLandmarks с пустыми данными.
 *
 * @param {Object} args
 * @param {string} args.planId
 * @param {string} args.userId
 * @returns {Promise<Object>}
 */
export async function clearLandmarks({ planId, userId }) {
  return saveLandmarks({
    planId,
    userId,
    landmarks: [],
    meta: {},
  });
}
