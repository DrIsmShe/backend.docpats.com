// common/models/system/OrphanR2File.js
//
// Очередь файлов в R2/S3, оставшихся "осиротевшими" после удаления
// родительских документов. Cron-воркер (jobs/r2OrphanCleanup.cron.js)
// читает unprocessed записи и удаляет файлы из R2.
//
// Зачем не удалять синхронно в сервисе delete:
//   - Если R2 тормозит / падает — пользователь ждёт / получает ошибку
//   - Если R2 недоступен — orphan файл остаётся, никто не повторит
//   - Очередь даёт retry, alert при N неудачах, метрики
//
// Источник записей сейчас: clinic-medical/imaging.service.deleteImaging.
// В будущем — любой места где удаляется документ с прикреплёнными R2 файлами
// (avatar, document attachments, и т.д.). Поэтому модель в common/system/,
// а не в clinic-medical.
//
// Поле fileUrl — публичный URL в формате `${R2_PUBLIC_URL}/${key}`.
// Cron парсит key через тот же split что и uploadMiddleware.deleteFile.

import mongoose from "mongoose";

const orphanR2FileSchema = new mongoose.Schema(
  {
    // ─── что удалить ───
    fileUrl: {
      type: String,
      required: true,
    },

    // ─── source tracking ───
    // Откуда пришёл orphan — для аудита и диагностики
    sourceModel: {
      type: String,
      required: true,
      // Не enum — список будет расширяться. Примеры:
      // "ImagingStudy", "User.avatar", "DialogMessage.attachment"
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      // ObjectId исходного документа (может быть null если удалили batch)
    },

    // Опциональная клиника-владелец (для multi-tenancy метрик)
    // Не индексируем — выборка идёт по succeeded+attempts, не по клинике
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      default: null,
    },

    // ─── processing state ───
    succeeded: {
      type: Boolean,
      default: false,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },

    // Когда исходный документ был удалён (≈ когда поставили в очередь)
    deletedAt: {
      type: Date,
      default: Date.now,
    },
    // Последняя попытка удаления (для backoff и debugging)
    lastAttemptedAt: {
      type: Date,
      default: null,
    },
    // Когда успешно удалили
    completedAt: {
      type: Date,
      default: null,
    },

    // Текст последней ошибки (для диагностики)
    lastError: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

// Композитный индекс для основного запроса cron'а:
//   find({ succeeded: false, attempts: { $lt: maxAttempts } })
// Сортировка по deletedAt чтобы старые orphan'ы обрабатывались первыми.
orphanR2FileSchema.index({ succeeded: 1, attempts: 1, deletedAt: 1 });

// Защита от двойной компиляции в dev hot-reload
const OrphanR2File =
  mongoose.models.OrphanR2File ||
  mongoose.model("OrphanR2File", orphanR2FileSchema);

export default OrphanR2File;
