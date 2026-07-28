// server/modules/radiology/radiology-attempts/models/radiologyAttempt.model.js
//
// RadiologyAttempt = одна попытка учащегося прочитать кейс. Зеркало
// ExamAttempt из education: хранит и ответ, и покомпонентную оценку, и
// разбор — чтобы результат был воспроизводим, а аналитика не врала.
//
// Правильный ответ клиенту до сдачи не отдаётся: старт попытки возвращает
// «санитизованный» кейс без findings/impression (см. attempt.service.js).

import mongoose from "mongoose";
import { ATTEMPT_STATUSES, FINDING_SHAPES } from "../../constants.js";
import { attemptPolicyFields } from "./attemptPolicyFields.js";

const { Schema } = mongoose;

// Разметка, которую поставил учащийся (та же геометрия, что у эталона).
const responseFindingSchema = new Schema(
  {
    imageIndex: { type: Number, required: true, min: 0 },
    label: { type: String, required: true, trim: true, maxlength: 60 },
    shape: { type: String, enum: FINDING_SHAPES, required: true },
    coords: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

// Результат сопоставления одной эталонной находки с ответом — основа
// разбора: что нашли, что пропустили, где ошиблись в названии.
const matchSchema = new Schema(
  {
    findingKey: { type: String, required: true }, // ключ эталонной находки
    label: { type: String, default: "" },
    significance: { type: String, default: "major" },
    // "hit" — найдено и верно локализовано; "missed" — пропущено;
    // остальное (ложные тревоги) считается отдельно в falseAlarms.
    outcome: { type: String, enum: ["hit", "missed"], required: true },
    labelCorrect: { type: Boolean, default: false },
  },
  { _id: false },
);

const scoreSchema = new Schema(
  {
    total: { type: Number, default: 0 }, // 0..1, перенормированный
    passed: { type: Boolean, default: false },
    // Покомпонентно (null = компонент не применялся и исключён из нормировки).
    detection: { type: Number, default: null },
    classification: { type: Number, default: null },
    checklist: { type: Number, default: null },
    diagnosis: { type: Number, default: null },
    aiImpression: { type: Number, default: null },
  },
  { _id: false },
);

const radiologyAttemptSchema = new Schema(
  {
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "RadiologyCase",
      required: true,
      index: true,
    },
    // Язык, на котором врач читал кейс. Нужен при сдаче: диагноз и заключение
    // сверяются со списками ЭТОГО языка, иначе верный ответ по-турецки не
    // засчитывается против русского эталона. Хранится в попытке, а не берётся
    // из запроса: переключение интерфейса между стартом и сдачей не должно
    // менять условия уже идущей попытки.
    lang: { type: String, enum: ["ru", "en", "az", "tr", "ar"], default: "ru" },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Режим, зачётность, лимит времени, сигналы добросовестности — общие для
    // всех станций арены (attemptPolicyFields.js).
    ...attemptPolicyFields(),
    status: {
      type: String,
      enum: ATTEMPT_STATUSES,
      default: "in_progress",
      index: true,
    },

    // ─── Ответ учащегося ───
    response: {
      findings: { type: [responseFindingSchema], default: [] },
      reviewedChecklist: { type: [String], default: [] },
      impressionText: { type: String, trim: true, maxlength: 4000, default: "" },
      diagnosisKeys: { type: [String], default: [] },
      // Формулировка диагноза как её написал учащийся: она и оценивается,
      // и нужна в разборе — без неё ответ врача в записи попытки терялся.
      diagnosisText: { type: String, trim: true, maxlength: 4000, default: "" },
    },

    // ─── Оценка и разбор ───
    score: { type: scoreSchema, default: () => ({}) },
    matches: { type: [matchSchema], default: [] },
    falseAlarms: { type: Number, default: 0 }, // размеченное там, где патологии нет
    // Разбор свободного заключения: { score, rationale, grader }.
    aiFeedback: { type: Schema.Types.Mixed, default: null },
    // Развёрнутый ИИ-разбор попытки (по запросу): { diagnosis, conclusion,
    // analysis }. Кэшируется, чтобы не звать модель повторно при открытии.
    aiAnalysis: { type: Schema.Types.Mixed, default: null },

    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "radiology_attempts" },
);

radiologyAttemptSchema.index({ userId: 1, caseId: 1, status: 1 });

const RadiologyAttempt =
  mongoose.models.RadiologyAttempt ||
  mongoose.model(
    "RadiologyAttempt",
    radiologyAttemptSchema,
    "radiology_attempts",
  );

export default RadiologyAttempt;
