// server/modules/education/education-items/models/examItem.model.js
//
// ExamItem = один вопрос банка.
//
// Проектные решения:
//   1. options[].key — стабильная буква/метка варианта ("A".."E").
//      correctKeys ссылается на неё, а не на индекс: при перемешивании
//      вариантов на выдаче индекс меняется, ключ — нет.
//   2. optionExplanations — объяснение по КАЖДОМУ неверному варианту.
//      Это то, за что учащиеся платят; без него банк — просто список.
//   3. source — обязательный блок происхождения (см. constants.js).
//      Вопрос со source.kind = "ai_generated" не может быть опубликован
//      без ревью человеком: гейт в item.service.js → assertPublishable.
//   4. version + previousVersionId: вопросы правятся постоянно (меняются
//      гайдлайны). Старые попытки ссылаются на ту версию, которую
//      учащийся реально видел, иначе аналитика врёт.
//   5. stats — счётчики для item analysis (p-value, дискриминация).
//      Обновляются при сдаче попытки, считаются на лету в аналитике.

import mongoose from "mongoose";
import {
  ITEM_TYPES,
  ITEM_STATUSES,
  ITEM_DIFFICULTIES,
  EXAM_LANGUAGES,
  DEFAULT_EXAM_LANGUAGE,
  SOURCE_KINDS,
} from "../../constants.js";

const { Schema } = mongoose;

const optionSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 4 },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    imageUrl: { type: String, trim: true, maxlength: 1000, default: null },
    // Почему этот вариант неверен (или верен). Пустое поле допустимо для
    // черновика, но рецензент обязан заполнить перед публикацией.
    explanation: { type: String, trim: true, maxlength: 4000, default: "" },
  },
  { _id: false },
);

const referenceSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 500 },
    url: { type: String, trim: true, maxlength: 1000, default: null },
    year: { type: Number, min: 1900, max: 2200, default: null },
  },
  { _id: false },
);

// Происхождение вопроса — юридически значимый блок.
const sourceSchema = new Schema(
  {
    kind: { type: String, enum: SOURCE_KINDS, required: true },
    // Орган/издание, откуда взят официальный материал.
    authority: { type: String, trim: true, maxlength: 300, default: null },
    url: { type: String, trim: true, maxlength: 1000, default: null },
    year: { type: Number, min: 1900, max: 2200, default: null },
    // Чем именно разрешено пользоваться (для kind = licensed / public_government).
    licenseNote: { type: String, trim: true, maxlength: 2000, default: null },
  },
  { _id: false },
);

// Статистика по варианту ответа: сколько раз его выбрали.
const optionStatSchema = new Schema(
  {
    key: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  { _id: false },
);

const examItemSchema = new Schema(
  {
    // ─── Привязка ───
    programId: {
      type: Schema.Types.ObjectId,
      ref: "ExamProgram",
      required: true,
      index: true,
    },
    // Код раздела blueprint программы. Нужен для скоринга по темам.
    topicCode: { type: String, trim: true, maxlength: 80, default: null },

    lang: {
      type: String,
      enum: EXAM_LANGUAGES,
      default: DEFAULT_EXAM_LANGUAGE,
      index: true,
    },

    // ─── Содержание ───
    type: { type: String, enum: ITEM_TYPES, default: "sba", index: true },
    // Условие. Для виньетки сюда идёт весь клинический сценарий.
    stem: { type: String, required: true, trim: true, maxlength: 8000 },
    stemImageUrl: { type: String, trim: true, maxlength: 1000, default: null },

    options: { type: [optionSchema], default: [] },
    correctKeys: { type: [String], default: [] },

    // Общее объяснение: почему верный ответ верен.
    explanation: { type: String, trim: true, maxlength: 8000, default: "" },
    references: { type: [referenceSchema], default: [] },

    difficulty: {
      type: String,
      enum: ITEM_DIFFICULTIES,
      default: "medium",
      index: true,
    },
    tags: { type: [String], default: [] },

    // ─── Происхождение ───
    source: { type: sourceSchema, required: true },

    // ─── Редакторский цикл ───
    status: {
      type: String,
      enum: ITEM_STATUSES,
      default: "draft",
      index: true,
    },
    version: { type: Number, default: 1 },
    previousVersionId: {
      type: Schema.Types.ObjectId,
      ref: "ExamItem",
      default: null,
    },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, maxlength: 2000, default: null },
    publishedAt: { type: Date, default: null },

    // ─── Импорт из ИИ ───
    importJobId: {
      type: Schema.Types.ObjectId,
      ref: "ExamImportJob",
      default: null,
      index: true,
    },
    // Уверенность экстрактора (0..1). Низкая — сигнал рецензенту.
    aiConfidence: { type: Number, min: 0, max: 1, default: null },

    // ─── Статистика ───
    stats: {
      served: { type: Number, default: 0 }, // сколько раз показан
      correct: { type: Number, default: 0 }, // сколько раз отвечен верно
      totalTimeMs: { type: Number, default: 0 }, // суммарное время на ответ
      optionCounts: { type: [optionStatSchema], default: [] },
    },
  },
  {
    timestamps: true,
    collection: "exam_items",
  },
);

// ─── Индексы ───
// Главный запрос сборки сессии: вопросы программы, языка, темы, статуса.
examItemSchema.index({ programId: 1, status: 1, lang: 1 });
examItemSchema.index({ programId: 1, status: 1, topicCode: 1, lang: 1 });
examItemSchema.index({ programId: 1, status: 1, difficulty: 1 });
examItemSchema.index({ status: 1, "source.kind": 1 }); // очередь ревью ИИ-вопросов
examItemSchema.index({ tags: 1 });

// ─── Виртуальные метрики ───
// p-value: доля верных ответов. Классический индекс лёгкости вопроса.
// < 0.3 — слишком трудный или некорректный; > 0.9 — не различает уровни.
examItemSchema.virtual("pValue").get(function () {
  if (!this.stats?.served) return null;
  return this.stats.correct / this.stats.served;
});

examItemSchema.set("toObject", { virtuals: true });
examItemSchema.set("toJSON", { virtuals: true });

const ExamItem =
  mongoose.models.ExamItem ||
  mongoose.model("ExamItem", examItemSchema, "exam_items");

export default ExamItem;
