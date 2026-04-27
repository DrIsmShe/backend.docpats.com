// server/modules/simulation/services/upload.service.js
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import {
  validateImageMetadata,
  FORMAT_TO_MIME,
  MIME_TO_EXT,
  UploadValidationError,
} from "../validators/upload.validator.js";
import { buildKey, putObject, deleteObject } from "../config/r2.js";

const MAX_STORED_DIMENSION = 4000;
const JPEG_QUALITY = 90;
const WEBP_QUALITY = 90;

/* ──────────────────────────────────────────────────────────────────────────
   S.7.5+ — CDN propagation wait.

   После putObject в R2, файл появляется в bucket мгновенно, но CDN edge
   (media.docpats.com) может видеть его не сразу. У некоторых users
   наблюдается ожидание 5-10 минут. Решение: HEAD-проверка на CDN URL
   с retry — не возвращаем URL клиенту пока не убедимся в доступности.

   Цикл: 6 попыток с возрастающим интервалом (0s, 1s, 2s, 4s, 8s, 15s).
   Итого ~30 секунд макс. Обычно пропагирует за 2-5 секунд.
   Если за 30 сек не появился — всё равно возвращаем URL (пусть клиент
   попробует через свой retry), но логируем warning.
   ────────────────────────────────────────────────────────────────────────── */

const CDN_CHECK_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HEAD-запрос на CDN URL. Возвращает true когда status 200/2xx.
 * Не бросает: при сетевых ошибках/timeout — возвращает false для retry.
 */
async function checkUrlAvailable(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForCdnPropagation(url) {
  // Попытка 0 — сразу
  if (await checkUrlAvailable(url)) {
    return { ok: true, attempts: 1, totalMs: 0 };
  }

  // Попытки 1..N с backoff
  let totalMs = 0;
  for (let i = 0; i < CDN_CHECK_DELAYS_MS.length; i++) {
    const waitMs = CDN_CHECK_DELAYS_MS[i];
    await delay(waitMs);
    totalMs += waitMs;

    if (await checkUrlAvailable(url)) {
      return { ok: true, attempts: i + 2, totalMs };
    }
  }

  return { ok: false, attempts: CDN_CHECK_DELAYS_MS.length + 1, totalMs };
}

/* ──────────────────────────────────────────────────────────────────────────
   Главный метод: buffer от multer → R2 → CDN-check → embedded photo object.
   ────────────────────────────────────────────────────────────────────────── */
export async function processAndUploadPhoto({
  buffer,
  doctorId,
  originalMimeType,
}) {
  if (!buffer || buffer.length === 0) {
    throw new UploadValidationError("Empty upload buffer", "empty_buffer");
  }

  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch (err) {
    throw new UploadValidationError(
      `Cannot read image: ${err.message}`,
      "unreadable_image",
    );
  }

  if (!meta.format || !FORMAT_TO_MIME[meta.format]) {
    throw new UploadValidationError(
      `Unsupported real format: ${meta.format || "unknown"}`,
      "invalid_format",
    );
  }

  const realMimeType = FORMAT_TO_MIME[meta.format];

  if (originalMimeType && originalMimeType !== realMimeType) {
    throw new UploadValidationError(
      `MIME mismatch: claimed ${originalMimeType}, actual ${realMimeType}`,
      "mime_mismatch",
    );
  }

  /* ────────────── Нормализация ────────────── */
  let pipeline = sharp(buffer).rotate();

  const needsDownscale =
    meta.width > MAX_STORED_DIMENSION || meta.height > MAX_STORED_DIMENSION;

  if (needsDownscale) {
    pipeline = pipeline.resize(MAX_STORED_DIMENSION, MAX_STORED_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  let finalMime;

  if (meta.format === "png") {
    pipeline = pipeline.png({ compressionLevel: 9 });
    finalMime = "image/png";
  } else if (meta.format === "webp") {
    pipeline = pipeline.webp({ quality: WEBP_QUALITY });
    finalMime = "image/webp";
  } else {
    pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
    finalMime = "image/jpeg";
  }

  const { data: processedBuffer, info } = await pipeline.toBuffer({
    resolveWithObject: true,
  });

  /* ────────────── Финальная валидация ────────────── */
  validateImageMetadata({
    format: info.format,
    width: info.width,
    height: info.height,
    sizeBytes: processedBuffer.length,
  });

  /* ────────────── Upload в R2 ────────────── */
  const ext = MIME_TO_EXT[finalMime];
  const filename = `${uuidv4()}.${ext}`;
  const r2Key = buildKey({ doctorId, planId: null, filename });

  const { url } = await putObject({
    key: r2Key,
    body: processedBuffer,
    contentType: finalMime,
  });

  /* ────────────── S.7.5+ — Wait for CDN propagation ────────────── */
  const cdnResult = await waitForCdnPropagation(url);
  if (cdnResult.ok) {
    if (cdnResult.totalMs > 0) {
      console.log(
        `[simulation/upload] CDN propagated in ${cdnResult.totalMs}ms ` +
          `(${cdnResult.attempts} attempts): ${url}`,
      );
    }
  } else {
    // Не блокируем upload — клиент попробует с retry на своей стороне.
    console.warn(
      `[simulation/upload] CDN propagation timeout after ${cdnResult.totalMs}ms ` +
        `(${cdnResult.attempts} attempts). Returning URL anyway: ${url}`,
    );
  }

  return {
    r2Key,
    url,
    width: info.width,
    height: info.height,
    size: processedBuffer.length,
    mimeType: finalMime,
    uploadedAt: new Date(),
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   Cleanup
   ────────────────────────────────────────────────────────────────────────── */
export async function deletePhotoObject(r2Key) {
  if (!r2Key) return;
  try {
    await deleteObject(r2Key);
  } catch (err) {
    console.error(
      `[simulation/upload] Failed to delete R2 object ${r2Key}:`,
      err,
    );
  }
}
