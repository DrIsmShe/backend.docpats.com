// server/modules/education/education-ingest/models/examImportJob.model.js
//
// ExamImportJob = один загруженный файл (PDF или картинка), из которого
// извлекаются вопросы.
//
// Поток: файл → экстрактор → draftItems (черновики В ЭТОМ документе) →
// ревью человеком → импорт в ExamItem → ревью рецензента → публикация.
//
// Почему черновики лежат здесь, а не сразу в банке вопросов: распознавание
// ошибается. Мусорный «вопрос» из шапки страницы не должен попадать в
// exam_items и портить статистику и очередь ревью. Сначала оператор
// вычищает распознанное, и только отобранное едет дальше.

import mongoose from "mongoose";
import {
  IMPORT_STATUSES,
  IMPORT_MIME_TYPES,
  ITEM_TYPES,
  ITEM_DIFFICULTIES,
  EXAM_LANGUAGES,
  DEFAULT_EXAM_LANGUAGE,
  SOURCE_KINDS,
} from "../../constants.js";

const { Schema } = mongoose;

const draftOptionSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 4 },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    explanation: { type: String, trim: true, maxlength: 4000, default: "" },
  },
  { _id: false },
);

// Распознанный вопрос-кандидат.
const draftItemSchema = new Schema(
  {
    index: { type: Number, required: true },
    type: { type: String, enum: ITEM_TYPES, default: "sba" },
    stem: { type: String, required: true, trim: true, maxlength: 8000 },
    options: { type: [draftOptionSchema], default: [] },
    correctKeys: { type: [String], default: [] },
    explanation: { type: String, trim: true, maxlength: 8000, default: "" },
    topicCode: { type: String, trim: true, maxlength: 80, default: null },
    difficulty: { type: String, enum: ITEM_DIFFICULTIES, default: "medium" },

    // Уверенность экстрактора (0..1). Ниже 0.6 — почти наверняка требует
    // ручной правки: обрезанное условие, потерянный вариант, кривой ключ.
    confidence: { type: Number, min: 0, max: 1, default: null },
    // Страница исходного файла — оператору нужно быстро найти оригинал.
    sourcePage: { type: Number, default: null },
    // Замечания экстрактора: «ключ ответа в файле не указан» и т.п.
    notes: { type: String, trim: true, maxlength: 1000, default: null },

    // Оператор отбраковал черновик.
    discarded: { type: Boolean, default: false },
    // Уже перенесён в банк вопросов.
    imported: { type: Boolean, default: false },
    itemId: { type: Schema.Types.ObjectId, ref: "ExamItem", default: null },
  },
  { _id: false },
);

const examImportJobSchema = new Schema(
  {
    programId: {
      type: Schema.Types.ObjectId,
      ref: "ExamProgram",
      required: true,
      index: true,
    },

    // ─── Исходный файл ───
    file: {
      // Ключ в Cloudflare R2 (media-хранилище проекта).
      key: { type: String, trim: true, maxlength: 500, default: null },
      url: { type: String, trim: true, maxlength: 1000, default: null },
      originalName: { type: String, trim: true, maxlength: 300, default: null },
      // Не required: у ручного экстрактора файла нет вовсе, вопросы приходят
      // уже разобранными. Обязательность проверяется в сервисе — только для
      // тех экстракторов, которые действительно читают файл.
      //
      // Без enum намеренно: браузеры присылают произвольные и неверные
      // MIME-типы (.csv как application/vnd.ms-excel, .md как пустая
      // строка). Пригодность файла определяет fileTypes.js по MIME И по
      // расширению; здесь мы просто фиксируем, что прислал клиент.
      mimeType: { type: String, trim: true, maxlength: 150, default: null },
      sizeBytes: { type: Number, default: null },
      pageCount: { type: Number, default: null },
    },

    // Имя экстрактора из реестра (manual | claude | generate).
    extractor: { type: String, trim: true, maxlength: 50, default: "manual" },

    // Задание на ГЕНЕРАЦИЮ вопросов моделью (extractor = "generate"). Для
    // импорта из файла — null. topic и count здесь, чтобы фоновая генерация
    // знала, что и сколько создавать, и чтобы оператор видел это в задании.
    generationSpec: {
      topic: { type: String, trim: true, maxlength: 500, default: null },
      count: { type: Number, default: null },
      difficulty: {
        type: String,
        enum: [...ITEM_DIFFICULTIES, "mixed"],
        default: "mixed",
      },
    },

    // ─── Значения по умолчанию для создаваемых вопросов ───
    defaults: {
      lang: {
        type: String,
        enum: EXAM_LANGUAGES,
        default: DEFAULT_EXAM_LANGUAGE,
      },
      topicCode: { type: String, trim: true, maxlength: 80, default: null },
      difficulty: {
        type: String,
        enum: ITEM_DIFFICULTIES,
        default: "medium",
      },
      // Происхождение СОДЕРЖАНИЯ (не способа извлечения). Для официального
      // государственного теста здесь public_government, даже если текст
      // распознала модель. Способ извлечения фиксируется importJobId
      // на самом вопросе.
      source: {
        kind: { type: String, enum: SOURCE_KINDS, default: "ai_generated" },
        authority: { type: String, trim: true, maxlength: 300, default: null },
        url: { type: String, trim: true, maxlength: 1000, default: null },
        year: { type: Number, default: null },
        licenseNote: {
          type: String,
          trim: true,
          maxlength: 2000,
          default: null,
        },
      },
    },

    status: {
      type: String,
      enum: IMPORT_STATUSES,
      default: "pending",
      index: true,
    },
    error: { type: String, trim: true, maxlength: 2000, default: null },

    draftItems: { type: [draftItemSchema], default: [] },

    stats: {
      detected: { type: Number, default: 0 },
      imported: { type: Number, default: 0 },
      discarded: { type: Number, default: 0 },
      // Токены, потраченные экстрактором — для контроля стоимости импорта.
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
    },

    // Прогресс распознавания по частям. Большой файл сервер режет на части
    // и гонит проходами (лимит модели — ~200–300 вопросов за раз), а клиент
    // опросом показывает «часть 3 из 12». total=1 — файл прошёл одним куском.
    progress: {
      current: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      // Части, где распознавание сорвалось (слишком плотный кусок и т.п.):
      // остальные части всё равно доводим и переносим — терять 9 частей
      // из-за одной нельзя.
      failedChunks: { type: Number, default: 0 },
    },

    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "exam_import_jobs",
  },
);

examImportJobSchema.index({ programId: 1, status: 1, createdAt: -1 });
examImportJobSchema.index({ createdBy: 1, createdAt: -1 });

const ExamImportJob =
  mongoose.models.ExamImportJob ||
  mongoose.model("ExamImportJob", examImportJobSchema, "exam_import_jobs");

export default ExamImportJob;
