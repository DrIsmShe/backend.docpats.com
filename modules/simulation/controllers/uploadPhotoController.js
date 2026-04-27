// server/modules/simulation/controllers/uploadPhotoController.js
import { processAndUploadPhoto } from "../services/upload.service.js";
import { UploadValidationError } from "../validators/upload.validator.js";

/* ──────────────────────────────────────────────────────────────────────────
   POST /api/simulation/photos
   multipart/form-data, поле "photo".

   Поток: multer кладёт файл в req.file.buffer → sharp проверяет реальные
   байты → нормализация → R2 → клиент получает embedded-photo объект,
   который потом подкладывает в createPlan.

   Двухшаговый upload (а не "всё в одном create") нужен потому что:
   — клиент хочет показать preview ДО создания плана,
   — create может упасть из-за валидации label, а фото уже залито,
   — в будущем: один и тот же upload может использоваться для нескольких
     планов (сейчас shared через duplicatePlan).
   ────────────────────────────────────────────────────────────────────────── */
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

    return res.status(201).json({ photo });
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
