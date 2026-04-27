// server/modules/anthropometry/models/Photo.model.js

import mongoose from "mongoose";

const { Schema } = mongoose;

/* ============================================================
   ENUMS
   ============================================================ */

// Стандартные проекции для пластической хирургии.
// Соответствуют ASPS Photo Standards.
const VIEW_TYPE_ENUM = [
  // Лицо
  "frontal", // фронтальная (анфас)
  "lateral_left", // профиль слева
  "lateral_right", // профиль справа
  "oblique_left", // ¾ слева
  "oblique_right", // ¾ справа
  "basal", // вид снизу (для ринопластики, "worm's eye")
  "superior", // вид сверху ("bird's eye")

  // Тело (для маммопластики и т.д.)
  "frontal_body",
  "lateral_left_body",
  "lateral_right_body",
  "posterior", // вид со спины

  "other", // нестандартная проекция
];

const PHOTO_STATUS_ENUM = [
  "uploading", // файл загружается (для chunked upload в будущем)
  "processing", // файл загружен, идёт обработка (хеш, размеры, превью)
  "ready", // готово к работе
  "failed", // ошибка при обработке
];

// Стандартные MIME-типы. Не разрешаем произвольные —
// иначе пользователь загрузит .exe с подменённым расширением.
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic", // iPhone-фото
  "image/webp",
];

/* ============================================================
   SUB-SCHEMA — accessLog
   ============================================================
   Встроенный лог последних обращений к фото.
   Полный аудит — в AnthropometryAuditLog. */

const AccessLogEntrySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    accessedAt: { type: Date, default: Date.now },
    action: {
      type: String,
      enum: ["view", "download", "annotate"],
      required: true,
    },
    ipAddress: { type: String },
  },
  { _id: false },
);

/* ============================================================
   MAIN SCHEMA
   ============================================================ */

const PhotoSchema = new Schema(
  {
    /* ---------------------------------
       PARENT REFERENCES
       --------------------------------- */
    studyId: {
      type: Schema.Types.ObjectId,
      ref: "Study",
      required: true,
      index: true,
    },

    // Денормализация для быстрых выборок без join
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "PatientCase",
      required: true,
      index: true,
    },

    doctorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* ---------------------------------
       VIEW METADATA
       --------------------------------- */
    viewType: {
      type: String,
      enum: VIEW_TYPE_ENUM,
      required: true,
      index: true,
    },

    // Иногда в одной сессии несколько одинаковых проекций
    // (например, два frontal — для проверки повторяемости).
    // Это поле помогает их различать в UI.
    sequenceInView: { type: Number, default: 1, min: 1 },

    /* ---------------------------------
       FILE STORAGE
       ---------------------------------
       storageKey — путь/ключ внутри хранилища.
       Формат: "anthropometry/{caseId}/{studyId}/{photoId}.{ext}"
       URL не храним — генерируется по запросу через signed URL. */
    storageKey: { type: String, required: true, unique: true },

    // Превью для списков и галерей
    thumbnailKey: { type: String },

    /* ---------------------------------
       FILE METADATA
       --------------------------------- */
    originalFilename: { type: String, required: true },

    mimeType: {
      type: String,
      enum: ALLOWED_MIME_TYPES,
      required: true,
    },

    fileSize: {
      type: Number,
      required: true,
      min: 1,
      max: 50 * 1024 * 1024, // 50 МБ — sanity limit
    },

    // Размеры в пикселях — критически важны для пересчёта
    // нормализованных координат точек. Без них Annotation
    // не работает.
    widthPx: { type: Number, required: true, min: 1 },
    heightPx: { type: Number, required: true, min: 1 },

    // SHA-256 от содержимого файла. Дедупликация и целостность.
    fileHash: { type: String, required: true, index: true },

    // EXIF-данные при наличии (модель камеры, дата съёмки и т.д.)
    // Mixed — потому что структура EXIF варьируется.
    // Кладём в подобъект, чтобы не засорять верхний уровень.
    exif: { type: Schema.Types.Mixed, default: null },

    /* ---------------------------------
       PROCESSING STATUS
       --------------------------------- */
    status: {
      type: String,
      enum: PHOTO_STATUS_ENUM,
      default: "processing",
      index: true,
    },

    processingError: { type: String },

    /* ---------------------------------
       HIPAA: ACCESS LOG (rolling window)
       ---------------------------------
       Последние N обращений к фото. Полный аудит —
       в AnthropometryAuditLog. Этот лог — для быстрого
       взгляда "кто смотрел это конкретное фото недавно". */
    accessLog: {
      type: [AccessLogEntrySchema],
      default: [],
      // Лимит контролируется в сервисе (см. addAccessLog ниже)
    },

    /* ---------------------------------
       SOFT DELETE
       --------------------------------- */
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
    deleteReason: { type: String },

    /* ---------------------------------
       AUDIT
       --------------------------------- */
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    uploadedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_, ret) => {
        // Не отдаём accessLog наружу через обычный API —
        // его читают только администраторы через спец-эндпоинт
        delete ret.accessLog;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

/* ============================================================
   VIRTUALS
   ============================================================ */

// Соотношение сторон — полезно для UI
PhotoSchema.virtual("aspectRatio").get(function () {
  if (!this.widthPx || !this.heightPx) return null;
  return this.widthPx / this.heightPx;
});

// Ориентация
PhotoSchema.virtual("orientation").get(function () {
  if (!this.widthPx || !this.heightPx) return null;
  if (this.widthPx > this.heightPx) return "landscape";
  if (this.widthPx < this.heightPx) return "portrait";
  return "square";
});

/* ============================================================
   INSTANCE METHODS
   ============================================================ */

// Добавление записи в accessLog с автоматическим лимитом.
// Не сохраняет — это делает caller через .save().
const ACCESS_LOG_MAX_ENTRIES = 100;

PhotoSchema.methods.addAccessLog = function (entry) {
  this.accessLog.push(entry);
  if (this.accessLog.length > ACCESS_LOG_MAX_ENTRIES) {
    // Оставляем последние N записей
    this.accessLog = this.accessLog.slice(-ACCESS_LOG_MAX_ENTRIES);
  }
};

// Готово ли фото к работе (не в processing, не сломано, не удалено)
PhotoSchema.methods.isReady = function () {
  return this.status === "ready" && this.isDeleted === false;
};

// Пересчёт нормализованных координат в пиксели
PhotoSchema.methods.normalizedToPixels = function (point) {
  return {
    x: point.x * this.widthPx,
    y: point.y * this.heightPx,
  };
};

// Обратный пересчёт
PhotoSchema.methods.pixelsToNormalized = function (point) {
  return {
    x: point.x / this.widthPx,
    y: point.y / this.heightPx,
  };
};

/* ============================================================
   STATIC METHODS
   ============================================================ */

PhotoSchema.statics.findActive = function (filter = {}) {
  return this.find({ ...filter, isDeleted: false });
};

PhotoSchema.statics.findOneActive = function (filter = {}) {
  return this.findOne({ ...filter, isDeleted: false });
};

// Все фото сессии в правильном порядке проекций.
// Возвращает в порядке VIEW_TYPE_ENUM (frontal первым).
PhotoSchema.statics.findByStudyOrdered = async function (studyId) {
  const photos = await this.find({
    studyId,
    isDeleted: false,
    status: "ready",
  }).lean();

  const orderMap = new Map(VIEW_TYPE_ENUM.map((v, i) => [v, i]));
  return photos.sort((a, b) => {
    const aOrder = orderMap.get(a.viewType) ?? 999;
    const bOrder = orderMap.get(b.viewType) ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.sequenceInView - b.sequenceInView;
  });
};

// Поиск дубликата по хешу (в рамках случая)
PhotoSchema.statics.findDuplicate = function (caseId, fileHash) {
  return this.findOne({ caseId, fileHash, isDeleted: false });
};

/* ============================================================
   INDEXES
   ============================================================ */

// Список фото сессии по проекциям (главный сценарий)
PhotoSchema.index({ studyId: 1, viewType: 1, isDeleted: 1 });

// Все фото случая
PhotoSchema.index({ caseId: 1, isDeleted: 1 });

// Поиск дубликатов по хешу
PhotoSchema.index({ caseId: 1, fileHash: 1 });

// Чистка зависших processing-фото (cron)
PhotoSchema.index({ status: 1, createdAt: 1 });

/* ============================================================
   MODEL
   ============================================================ */

const Photo =
  mongoose.models.Photo ||
  mongoose.model("Photo", PhotoSchema, "anthropometry_photos");

export default Photo;
