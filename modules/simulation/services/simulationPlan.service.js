// server/modules/simulation/services/simulationPlan.service.js
import mongoose from "mongoose";
import SimulationPlan from "../models/SimulationPlan.js";
import { encrypt, safeDecrypt } from "./encryption.service.js";
import { deletePhotoObject } from "./upload.service.js";

/* ──────────────────────────────────────────────────────────────────────────
   Сервисный слой для SimulationPlan. Правила:

   1. Все методы принимают doctorId как первый аргумент — это ownership
      фильтр для КАЖДОГО запроса. Сервер никогда не доверяет clientId
      из body.
   2. Шифрование/дешифрование label и patientRef происходит ТОЛЬКО здесь.
      Controllers работают с plaintext, модель хранит ciphertext.
   3. Soft delete везде — deletedAt ставится, физический файл R2 тоже
      удаляется (hard-delete файла, soft-delete документа). Это компромисс:
      undo "удалил план" возможен, но фото уже не вернёшь.
   4. Все методы возвращают уже desereliazed объект (plain object с
      расшифрованным label), а не mongoose Document.
   ────────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────────
   DTO helper. Превращает mongoose document в plain object для API.
   safeDecrypt — листинги не должны падать из-за одной битой записи.
   ────────────────────────────────────────────────────────────────────────── */
function toPlanDTO(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : doc;

  return {
    id: String(obj._id),
    doctorId: String(obj.doctorId),
    label: safeDecrypt(obj.labelEncrypted, ""),
    patientRef: safeDecrypt(obj.patientRefEncrypted, ""),
    photo: {
      url: obj.photo.url,
      width: obj.photo.width,
      height: obj.photo.height,
      mimeType: obj.photo.mimeType,
      uploadedAt: obj.photo.uploadedAt,
      // r2Key НЕ отдаём клиенту — внутренний идентификатор.
    },
    controlPoints: obj.controlPoints || [],
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    deletedAt: obj.deletedAt || null,
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
   LIST — пагинация через cursor (_id + createdAt desc).
   Cursor-based лучше offset/limit: стабильна при вставках, масштабируется.
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
    // Cursor — последний _id из предыдущей страницы. Идём "меньше чем он"
    // при сортировке по _id desc.
    query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const docs = await SimulationPlan.find(query)
    .sort({ _id: -1 })
    .limit(limit + 1) // +1 чтобы определить hasMore без второго запроса
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
   GET ById — с ownership check. Если план чужой ИЛИ удалён — 404
   (не 403 — не раскрываем сам факт существования).
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
   UPDATE — частичное. Шифруем то, что шифруется; controlPoints пишем
   как есть.
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
    // Валидатор уже гарантировал min(1), но на всякий случай.
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
   DELETE — soft. Документ помечается deletedAt, R2-объект удаляется
   физически (compromise — см. header).

   Если планы уже был удалён — идемпотентно возвращаем тот же результат.
   ────────────────────────────────────────────────────────────────────────── */
export async function deletePlan(doctorId, planId) {
  if (!mongoose.isValidObjectId(planId)) return null;

  const doc = await SimulationPlan.findOneAndUpdate(
    { _id: planId, doctorId },
    { $set: { deletedAt: new Date() } },
    { new: true },
  );

  if (!doc) return null;

  // Физическое удаление фото в R2. Best-effort — если упадёт, план всё
  // равно помечен удалённым, а r2Key остался в документе для ручного
  // cleanup. Не throw'им.
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
   DUPLICATE — копирует всё (включая controlPoints), но с новым _id и
   новым label. Фото НЕ копируем физически: новый план ссылается на тот
   же r2Key.

   ВАЖНО: это нарушает правило "каждый план владеет своим фото" (см.
   валидатор). На практике это означает: если удалить оригинал, фото
   исчезнет и в копии. Альтернатива — копировать R2-объект (CopyObject
   SDK команда), но это +1 запрос и +storage. Для MVP оставляем shared,
   позже при нужде добавим deep-copy.

   Компенсация: deletePlan больше НЕ удаляет R2 если r2Key есть в другой
   живой записи. Это проверим там же.
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
    patientRefEncrypted: original.patientRefEncrypted, // та же зашифр. строка
    photo: original.photo, // shared r2Key
    controlPoints: original.controlPoints,
  });

  return toPlanDTO(doc);
}

/* ──────────────────────────────────────────────────────────────────────────
   Проверка: используется ли r2Key в другом живом плане (для delete).
   Нужна потому что duplicatePlan шарит фото.
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
