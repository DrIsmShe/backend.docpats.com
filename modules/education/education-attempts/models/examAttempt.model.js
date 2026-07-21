// server/modules/education/education-attempts/models/examAttempt.model.js
//
// ExamAttempt = одна сессия прохождения: тренировка, таймированный блок
// или полноценный пробный экзамен.
//
// Проектные решения:
//   1. questions — СНИМОК состава на момент старта: itemId + version +
//      topicCode. Вопрос могут перепубликовать новой версией, но попытка
//      должна остаться воспроизводимой, а разбор — показывать ровно то,
//      что видел учащийся.
//   2. correctKeys в попытке НЕ хранятся. Ответ проверяется на сервере
//      сверкой с ExamItem; клиент не получает ключей до ответа.
//   3. timeSpentMs по каждому ответу — сильнейший диагностический сигнал:
//      быстрый неверный = не знает, медленный верный = знает шатко.
//   4. score.byTopic — основа экрана «готовность к экзамену».

import mongoose from "mongoose";
import {
  ATTEMPT_MODES,
  ATTEMPT_STATUSES,
  EXAM_LANGUAGES,
  DEFAULT_EXAM_LANGUAGE,
} from "../../constants.js";

const { Schema } = mongoose;

// Снимок вопроса в составе попытки.
const attemptQuestionSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "ExamItem", required: true },
    // Версия вопроса на момент выдачи.
    itemVersion: { type: Number, default: 1 },
    topicCode: { type: String, default: null },
    order: { type: Number, required: true },
  },
  { _id: false },
);

const attemptResponseSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "ExamItem", required: true },
    selectedKeys: { type: [String], default: [] },
    isCorrect: { type: Boolean, default: false },
    // Время на этот конкретный вопрос, мс. Приходит с клиента, ограничено
    // сверху в сервисе — доверять таймеру браузера полностью нельзя.
    timeSpentMs: { type: Number, default: 0, min: 0 },
    // Учащийся пометил вопрос «вернуться позже».
    flagged: { type: Boolean, default: false },
    answeredAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// Результат по одной теме blueprint.
const topicScoreSchema = new Schema(
  {
    topicCode: { type: String, default: null },
    title: { type: String, default: null },
    correct: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    percent: { type: Number, default: 0 },
  },
  { _id: false },
);

const examAttemptSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    programId: {
      type: Schema.Types.ObjectId,
      ref: "ExamProgram",
      required: true,
      index: true,
    },
    // Для внутреннего обучения персонала: кто из клиник назначил.
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      default: null,
      index: true,
    },

    mode: { type: String, enum: ATTEMPT_MODES, required: true, index: true },
    lang: {
      type: String,
      enum: EXAM_LANGUAGES,
      default: DEFAULT_EXAM_LANGUAGE,
    },

    // Если попытка проходит один блок большого теста — номер блока (0-based).
    // null = попытка по всему тесту (обычные режимы). Хранится, чтобы при
    // возврате на страницу можно было продолжить именно тот блок.
    blockIndex: { type: Number, default: null },

    questions: { type: [attemptQuestionSchema], default: [] },
    responses: { type: [attemptResponseSchema], default: [] },

    status: {
      type: String,
      enum: ATTEMPT_STATUSES,
      default: "in_progress",
      index: true,
    },

    startedAt: { type: Date, default: Date.now },
    // Жёсткий дедлайн для timed/mock. null для tutor/drill.
    expiresAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },

    score: {
      correct: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      percent: { type: Number, default: 0 },
      passed: { type: Boolean, default: false },
      passingScorePercent: { type: Number, default: null },
      byTopic: { type: [topicScoreSchema], default: [] },
      totalTimeMs: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    collection: "exam_attempts",
  },
);

// ─── Индексы ───
// «Мои попытки по программе», от новых к старым.
examAttemptSchema.index({ userId: 1, programId: 1, createdAt: -1 });
// Поиск незавершённой попытки при возврате на страницу.
examAttemptSchema.index({ userId: 1, status: 1 });
// Отчёт клиники по обучению персонала.
examAttemptSchema.index({ clinicId: 1, programId: 1, status: 1 });

const ExamAttempt =
  mongoose.models.ExamAttempt ||
  mongoose.model("ExamAttempt", examAttemptSchema, "exam_attempts");

export default ExamAttempt;
