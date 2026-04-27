// server/modules/anthropometry/utils/storage/storageKeys.js

import crypto from "crypto";

/* ============================================================
   STORAGE KEYS
   ============================================================
   Хелперы для генерации путей в хранилище.
   Один источник правды для структуры папок в bucket.

   Структура bucket:
     anthropometry/
     ├── photos/
     │   └── {caseId}/
     │       └── {studyId}/
     │           └── {photoId}.{ext}
     ├── thumbnails/
     │   └── {caseId}/
     │       └── {studyId}/
     │           └── {photoId}.jpg     ← всегда jpg
     └── exports/
         └── {caseId}/
             └── {timestamp}-{hash}.pdf
   ============================================================ */

const ROOT = "anthropometry";

/* ============================================================
   PHOTO KEYS
   ============================================================ */

/**
 * Ключ для оригинального фото.
 *
 * @param {Object} params
 * @param {String} params.caseId
 * @param {String} params.studyId
 * @param {String} params.photoId
 * @param {String} params.extension — без точки ('jpg', 'png', 'heic')
 */
export const photoKey = ({ caseId, studyId, photoId, extension }) => {
  if (!caseId || !studyId || !photoId || !extension) {
    throw new Error("photoKey requires caseId, studyId, photoId, extension");
  }
  const ext = String(extension).toLowerCase().replace(/^\./, "");
  return `${ROOT}/photos/${caseId}/${studyId}/${photoId}.${ext}`;
};

/**
 * Ключ для превью (всегда JPEG для совместимости).
 */
export const thumbnailKey = ({ caseId, studyId, photoId }) => {
  if (!caseId || !studyId || !photoId) {
    throw new Error("thumbnailKey requires caseId, studyId, photoId");
  }
  return `${ROOT}/thumbnails/${caseId}/${studyId}/${photoId}.jpg`;
};

/* ============================================================
   EXPORT KEYS (для будущих PDF-отчётов)
   ============================================================ */

export const exportKey = ({ caseId, type = "pdf" }) => {
  if (!caseId) throw new Error("exportKey requires caseId");
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString("hex");
  return `${ROOT}/exports/${caseId}/${timestamp}-${randomSuffix}.${type}`;
};

/* ============================================================
   PREFIX HELPERS — для bulk-операций
   ============================================================ */

/**
 * Префикс всех файлов случая (для каскадного удаления).
 * Используется в S3 listObjects с prefix фильтром.
 */
export const casePrefix = (caseId) => `${ROOT}/photos/${caseId}/`;

export const caseThumbsPrefix = (caseId) => `${ROOT}/thumbnails/${caseId}/`;

/**
 * Префикс всех файлов сессии.
 */
export const studyPrefix = (caseId, studyId) =>
  `${ROOT}/photos/${caseId}/${studyId}/`;

export const studyThumbsPrefix = (caseId, studyId) =>
  `${ROOT}/thumbnails/${caseId}/${studyId}/`;

/* ============================================================
   VALIDATION
   ============================================================ */

/**
 * Проверка что строка похожа на наш storage key.
 * Защита от случайного использования произвольной строки.
 */
export const isValidStorageKey = (key) => {
  if (typeof key !== "string" || key.length === 0) return false;
  // Должен начинаться с anthropometry/
  if (!key.startsWith(`${ROOT}/`)) return false;
  // Не должен содержать опасных символов
  if (key.includes("..") || key.includes("//")) return false;
  return true;
};

/**
 * Извлекает расширение из storage key.
 */
export const getExtension = (key) => {
  const lastDot = key.lastIndexOf(".");
  if (lastDot === -1) return null;
  return key.slice(lastDot + 1).toLowerCase();
};
