// server/modules/radiology/labs-station/models/labAttempt.model.js
//
// Попытка на станции «Анализы». Зеркалит RadiologyAttempt по духу: ответ +
// покомпонентная оценка + разбор. Начисление XP идёт через общий игровой
// слой арены (game.service), поэтому отдельного «профиля» здесь нет.

import mongoose from "mongoose";
import { ATTEMPT_STATUSES } from "../../constants.js";
import { attemptPolicyFields } from "../../radiology-attempts/models/attemptPolicyFields.js";

const { Schema } = mongoose;

const matchSchema = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, default: "" },
    outcome: { type: String, enum: ["hit", "missed"], required: true },
  },
  { _id: false },
);

const scoreSchema = new Schema(
  {
    total: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    detection: { type: Number, default: null },
    diagnosis: { type: Number, default: null },
    impression: { type: Number, default: null },
  },
  { _id: false },
);

const labAttemptSchema = new Schema(
  {
    caseId: { type: Schema.Types.ObjectId, ref: "LabCase", required: true, index: true },
    // Язык, на котором врач читал кейс. Нужен при сдаче: диагноз и заключение
    // сверяются со списками ЭТОГО языка, иначе верный ответ по-турецки не
    // засчитывается против русского эталона. Хранится в попытке, а не берётся
    // из запроса: переключение интерфейса между стартом и сдачей не должно
    // менять условия уже идущей попытки.
    lang: { type: String, enum: ["ru", "en", "az", "tr", "ar"], default: "ru" },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Список статусов — общий (constants.js), а не свой: в нём есть expired,
    // и локальная копия enum'а уже один раз разъехалась с реальностью.
    status: { type: String, enum: ATTEMPT_STATUSES, default: "in_progress" },
    // Режим, зачётность, лимит времени, сигналы добросовестности — общие для
    // всех станций арены (attemptPolicyFields.js).
    ...attemptPolicyFields(),
    // Какой числовой вариант кейса достался этой попытке (0 — базовый кейс
    // автора). Хранится, чтобы разбор и пересчёт оценки шли по тем же цифрам,
    // которые видел врач.
    variantIndex: { type: Number, default: 0 },
    variantLabel: { type: String, trim: true, maxlength: 60, default: "" },

    response: {
      // Ключи показателей, которые учащийся отметил как отклонённые.
      flags: { type: [String], default: [] },
      impressionText: { type: String, trim: true, maxlength: 4000, default: "" },
      diagnosisKeys: { type: [String], default: [] },
      // Формулировка диагноза как её написал учащийся: она и оценивается,
      // и нужна в разборе — без неё ответ врача в записи попытки терялся.
      diagnosisText: { type: String, trim: true, maxlength: 4000, default: "" },
    },

    score: { type: scoreSchema, default: () => ({}) },
    matches: { type: [matchSchema], default: [] },
    falsePositives: { type: Number, default: 0 }, // отметил норму как отклонение
    aiFeedback: { type: Schema.Types.Mixed, default: null },

    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "lab_attempts" },
);

labAttemptSchema.index({ userId: 1, caseId: 1, status: 1 });

const LabAttempt =
  mongoose.models.LabAttempt ||
  mongoose.model("LabAttempt", labAttemptSchema, "lab_attempts");

export default LabAttempt;
