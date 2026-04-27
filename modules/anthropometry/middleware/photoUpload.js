import multer from "multer";
import { ValidationError } from "../utils/errors.js";

/* ============================================================
   PHOTO UPLOAD MIDDLEWARE
   ============================================================
   Использует multer с memoryStorage — файл попадает в
   req.file.buffer как Buffer.

   Контроллер потом передаёт буфер в photo.service.uploadPhoto,
   который сам валидирует MIME, читает метаданные и грузит в R2.

   Лимит размера и типов дублирует валидацию в сервисе —
   это намеренно, чтобы отказать на уровне middleware и не
   тратить память на запрещённые файлы. */

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/heic", "image/webp"];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, // только один файл за запрос
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      cb(
        new ValidationError("Unsupported MIME type for photo", {
          received: file.mimetype,
          allowed: ALLOWED_MIME,
        }),
        false,
      );
      return;
    }
    cb(null, true);
  },
});

/**
 * Middleware для одного фото — поле формы 'photo'.
 *
 * Использование в route:
 *   router.post("/photos", uploadPhoto, controller);
 *
 * После прохождения:
 *   req.file = { buffer, mimetype, originalname, size, ... }
 *   req.body = { viewType, ... } — обычные form fields
 */
export const uploadPhoto = upload.single("photo");

/* ============================================================
   ERROR HANDLER ДЛЯ MULTER
   ============================================================
   multer бросает свои собственные ошибки (LIMIT_FILE_SIZE,
   LIMIT_UNEXPECTED_FILE, и т.д.). Этот middleware превращает
   их в наши ValidationError, чтобы handleErrors мог их
   обработать единообразно. */

export const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    let message;
    switch (err.code) {
      case "LIMIT_FILE_SIZE":
        message = `File too large (max ${MAX_FILE_SIZE} bytes)`;
        break;
      case "LIMIT_UNEXPECTED_FILE":
        message = `Unexpected file field. Use 'photo' as field name.`;
        break;
      case "LIMIT_FILE_COUNT":
        message = `Too many files (max 1)`;
        break;
      default:
        message = `Upload error: ${err.message}`;
    }
    return next(new ValidationError(message, { multerCode: err.code }));
  }
  next(err);
};

export default uploadPhoto;
