// server/modules/simulation/middleware/upload.middleware.js
import multer from "multer";
import {
  multerFileFilter,
  MAX_UPLOAD_SIZE,
  UploadValidationError,
} from "../validators/upload.validator.js";

/* ──────────────────────────────────────────────────────────────────────────
   Multer в memory. Буфер идёт в sharp для real metadata check, потом
   в R2. Диск не трогаем — R2 уже финальное хранилище.

   Одно фото за раз, поле "photo". fileSize — hard-limit на уровне multer,
   чтобы не загружать в память 500 MB от злого клиента.
   ────────────────────────────────────────────────────────────────────────── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE,
    files: 1,
  },
  fileFilter: multerFileFilter,
});

export const uploadSinglePhoto = upload.single("photo");

/* ──────────────────────────────────────────────────────────────────────────
   Error handler — ставится СРАЗУ после uploadSinglePhoto в роуте.
   Без этого multer-ошибки (LIMIT_FILE_SIZE, MULTER_UNEXPECTED_FILE, наш
   UploadValidationError из fileFilter) улетят в глобальный error handler
   как 500. Оборачиваем в 400 с внятным кодом.
   ────────────────────────────────────────────────────────────────────────── */
export function handleUploadErrors(err, req, res, next) {
  if (!err) return next();

  if (err instanceof multer.MulterError) {
    const map = {
      LIMIT_FILE_SIZE: { status: 413, code: "file_too_large" },
      LIMIT_FILE_COUNT: { status: 400, code: "too_many_files" },
      LIMIT_UNEXPECTED_FILE: { status: 400, code: "unexpected_field" },
    };
    const m = map[err.code] || { status: 400, code: "upload_error" };
    return res.status(m.status).json({
      error: m.code,
      message: err.message,
    });
  }

  if (err instanceof UploadValidationError) {
    return res.status(400).json({
      error: err.code,
      message: err.message,
    });
  }

  // Всё остальное — не наше, пусть глобальный handler разбирается.
  return next(err);
}
