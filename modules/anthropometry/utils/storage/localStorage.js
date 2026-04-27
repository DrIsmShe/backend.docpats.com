// server/modules/anthropometry/utils/storage/localStorage.js

import fs from "fs/promises";
import path from "path";
import { isValidStorageKey } from "./storageKeys.js";

/* ============================================================
   LOCAL STORAGE DRIVER
   ============================================================
   Хранит файлы на локальном диске. Только для разработки!
   В production используется s3Storage. */

const BASE_PATH = process.env.LOCAL_STORAGE_PATH || "./storage/anthropometry";

const PUBLIC_URL =
  process.env.LOCAL_STORAGE_PUBLIC_URL || "http://localhost:11000/storage";

/**
 * Безопасное преобразование storageKey в абсолютный путь файла.
 * Защита от path traversal атак ("../../etc/passwd").
 */
const resolveLocalPath = (storageKey) => {
  if (!isValidStorageKey(storageKey)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  const fullPath = path.resolve(BASE_PATH, storageKey);
  const basePath = path.resolve(BASE_PATH);
  if (!fullPath.startsWith(basePath + path.sep) && fullPath !== basePath) {
    throw new Error(`Path traversal attempt: ${storageKey}`);
  }
  return fullPath;
};

/* ============================================================
   UPLOAD
   ============================================================ */

export const upload = async (buffer, options) => {
  const { storageKey, contentType } = options;

  if (!Buffer.isBuffer(buffer)) {
    throw new Error("upload requires a Buffer");
  }
  if (!storageKey) {
    throw new Error("upload requires storageKey in options");
  }

  const fullPath = resolveLocalPath(storageKey);
  const dir = path.dirname(fullPath);

  // Создаём папку если нет
  await fs.mkdir(dir, { recursive: true });

  // Записываем файл
  await fs.writeFile(fullPath, buffer);

  return {
    storageKey,
    size: buffer.length,
    contentType: contentType || "application/octet-stream",
  };
};

/* ============================================================
   DELETE
   ============================================================ */

export const remove = async (storageKey) => {
  const fullPath = resolveLocalPath(storageKey);
  try {
    await fs.unlink(fullPath);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false; // файла нет — это ок
    throw err;
  }
};

/* ============================================================
   EXISTS
   ============================================================ */

export const exists = async (storageKey) => {
  const fullPath = resolveLocalPath(storageKey);
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
};

/* ============================================================
   GET METADATA
   ============================================================ */

export const getMetadata = async (storageKey) => {
  const fullPath = resolveLocalPath(storageKey);
  try {
    const stats = await fs.stat(fullPath);
    return {
      size: stats.size,
      lastModified: stats.mtime,
      contentType: undefined, // local driver не хранит contentType
    };
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
};

/* ============================================================
   GET URLS
   ============================================================
   Local driver не знает про signed URLs — просто отдаёт
   обычный URL через Express static. Это OK для dev. */

export const getSignedUrl = async (storageKey, _ttlSeconds) => {
  if (!isValidStorageKey(storageKey)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  return `${PUBLIC_URL}/${storageKey}`;
};

export const getPublicUrl = (storageKey) => {
  if (!isValidStorageKey(storageKey)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  return `${PUBLIC_URL}/${storageKey}`;
};

/* ============================================================
   READ (для тестов и будущей миграции в S3)
   ============================================================ */

export const read = async (storageKey) => {
  const fullPath = resolveLocalPath(storageKey);
  return fs.readFile(fullPath);
};

/* ============================================================
   HEALTH CHECK
   ============================================================ */

export const healthCheck = async () => {
  try {
    await fs.mkdir(BASE_PATH, { recursive: true });
    const testFile = path.join(BASE_PATH, ".healthcheck");
    await fs.writeFile(testFile, "ok");
    await fs.unlink(testFile);
    return { ok: true, driver: "local", basePath: BASE_PATH };
  } catch (err) {
    return { ok: false, driver: "local", error: err.message };
  }
};

/* ============================================================
   DEFAULT EXPORT
   ============================================================ */

export default {
  upload,
  remove,
  exists,
  getMetadata,
  getSignedUrl,
  getPublicUrl,
  read,
  healthCheck,
  driver: "local",
};
