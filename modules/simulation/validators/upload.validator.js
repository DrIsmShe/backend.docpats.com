// server/modules/simulation/validators/upload.validator.js
import Joi from "joi";

/* ──────────────────────────────────────────────────────────────────────────
   Upload лимиты.
   MAX_UPLOAD_SIZE — 20 MB. Типичное фото со смартфона 3-8 MB, DSLR
   до 15 MB. Больше не принимаем — в preview всё равно downscale до 1200px.
   MIN_DIMENSION — 200px. Меньше не имеет смысла для редактора.
   MAX_DIMENSION — 10000px. Больше — подозрительно (8K = 7680px).
   ────────────────────────────────────────────────────────────────────────── */
export const MAX_UPLOAD_SIZE = 20 * 1024 * 1024;
export const MIN_DIMENSION = 200;
export const MAX_DIMENSION = 10000;

export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

/* ──────────────────────────────────────────────────────────────────────────
   Extension → MIME. Используется в upload.service для финального ключа R2
   (расширение в имени файла берётся из MIME, не из original filename —
   клиент может прислать "photo" без расширения или "shell.exe.jpg").
   ────────────────────────────────────────────────────────────────────────── */
export const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/* ──────────────────────────────────────────────────────────────────────────
   Multer-уровневая проверка. Вызывается из upload.middleware до того, как
   файл попадёт в memory — отсекаем явный мусор до чтения всего body.
   ────────────────────────────────────────────────────────────────────────── */
export function multerFileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new UploadValidationError(
        `Unsupported mime type: ${file.mimetype}. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
        "invalid_mime",
      ),
      false,
    );
  }
  cb(null, true);
}

/* ──────────────────────────────────────────────────────────────────────────
   Controller-уровневая проверка. Multer сам НЕ знает реальный размер/тип —
   MIME в HTTP headers легко подделывается. Настоящую валидацию делаем
   после того как sharp прочитал метаданные из байтов.

   Вызывать из upload-controller с результатом sharp(buffer).metadata().
   ────────────────────────────────────────────────────────────────────────── */
const imageMetadataSchema = Joi.object({
  format: Joi.string().valid("jpeg", "png", "webp").required(),
  width: Joi.number()
    .integer()
    .min(MIN_DIMENSION)
    .max(MAX_DIMENSION)
    .required(),
  height: Joi.number()
    .integer()
    .min(MIN_DIMENSION)
    .max(MAX_DIMENSION)
    .required(),
  sizeBytes: Joi.number().integer().min(1).max(MAX_UPLOAD_SIZE).required(),
}).unknown(true); // sharp возвращает кучу полей — нас интересуют только четыре

export function validateImageMetadata(meta) {
  const { value, error } = imageMetadataSchema.validate(meta, {
    abortEarly: false,
    convert: false,
  });

  if (error) {
    throw new UploadValidationError(
      error.details.map((d) => d.message).join("; "),
      "invalid_image",
    );
  }

  return value;
}

/* ──────────────────────────────────────────────────────────────────────────
   Кастомный error class — controller ловит по имени и отдаёт 400 вместо
   500 без утечки внутренностей.
   ────────────────────────────────────────────────────────────────────────── */
export class UploadValidationError extends Error {
  constructor(message, code = "upload_error") {
    super(message);
    this.name = "UploadValidationError";
    this.code = code;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   Sharp format → MIME. Обратная карта, для явного соответствия между тем,
   что реально лежит в байтах, и тем, что мы запишем в БД.
   ────────────────────────────────────────────────────────────────────────── */
export const FORMAT_TO_MIME = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
