// server/modules/simulation/controllers/uploadPhotoController.js
//
// S.7.7+ — отдаём клиенту photo с proxy URL вместо CDN URL.
// Это критично: клиент использует photo.url СРАЗУ для preview перед
// созданием плана. Если бы мы отдавали CDN URL — preview ждал бы
// Cloudflare propagation 5-30 минут.

import { processAndUploadPhoto } from "../services/upload.service.js";
import { UploadValidationError } from "../validators/upload.validator.js";

/**
 * S.7.7+ — Строит proxy URL из r2Key.
 * Должен совпадать с реализацией в simulationPlan.service.js.
 */
function buildPhotoProxyUrl(r2Key) {
  if (!r2Key) return null;
  return `/api/simulation/photos/proxy?key=${encodeURIComponent(r2Key)}`;
}

export async function uploadPhotoController(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "no_file",
        message: 'No file uploaded (expected field "photo")',
      });
    }

    const photo = await processAndUploadPhoto({
      buffer: req.file.buffer,
      doctorId: req.doctorId,
      originalMimeType: req.file.mimetype,
    });

    // S.7.7+ — подменяем url на proxy URL
    const responsePhoto = {
      ...photo,
      url: buildPhotoProxyUrl(photo.r2Key),
    };

    return res.status(201).json({ photo: responsePhoto });
  } catch (err) {
    if (err instanceof UploadValidationError) {
      return res.status(400).json({
        error: err.code,
        message: err.message,
      });
    }
    console.error("[simulation/uploadPhoto] Unexpected error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: "Failed to process upload",
    });
  }
}
