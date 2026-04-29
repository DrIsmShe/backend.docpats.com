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
   S.7.7+ — Убрана waitForCdnPropagation:
     Раньше после putObject в R2 мы ждали до 30 секунд пока CDN
     (media.docpats.com) пропагирует файл. Эта задержка передавалась
     клиенту как медленный upload. Хуже того — она не гарантировала
     результат: Cloudflare иногда пропагирует через 5-30 МИНУТ.

     Новое решение: фронт ходит за фото через backend proxy
     (/api/simulation/photos/proxy?key=...), который читает напрямую
     из R2 через S3 SDK. R2 internal API имеет минимальную eventual
     consistency (~1 сек), поэтому фото доступно через proxy сразу
     после upload. Никаких задержек.

   Главная функция: buffer от multer → sharp normalize → R2 → embedded photo.
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

  // S.7.7+ — НЕ ждём CDN пропагации. Клиент ходит через backend proxy
  // (см. photoProxyController), который читает прямо из R2.

  return {
    r2Key,
    url, // CDN URL остаётся в БД как fallback (если когда-то откатимся на CDN)
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
