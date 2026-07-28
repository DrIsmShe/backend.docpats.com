// server/modules/radiology/virtual-patient/models/vpAttempt.model.js
//
// Попытка режима «Виртуальный пациент». XP начисляется через общий игровой
// слой арены (game.service), поэтому своего профиля нет.

import mongoose from "mongoose";
import { ATTEMPT_STATUSES } from "../../constants.js";
import { attemptPolicyFields } from "../../radiology-attempts/models/attemptPolicyFields.js";

const { Schema } = mongoose;

const scoreSchema = new Schema(
  {
    total: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    diagnosis: { type: Number, default: null },
    workup: { type: Number, default: null }, // разумность набора обследований
    reasoning: { type: Number, default: null },
    // Предварительная версия: попал ли верный диагноз в дифференциальный ряд,
    // названный ДО раскрытия результатов обследований.
    prior: { type: Number, default: null },
  },
  { _id: false },
);

// Предварительная фиксация дифдиагноза. Хранится с временем и числом уже
// заказанных обследований: «назвал по одной жалобе» и «назвал, посмотрев
// половину анализов» — разные вещи, и в разборе это видно.
const commitmentSchema = new Schema(
  {
    text: { type: String, trim: true, maxlength: 2000, default: "" },
    committedAt: { type: Date, default: null },
    orderedBefore: { type: Number, default: 0 },
    hit: { type: Boolean, default: false },
    matched: { type: String, default: "" },
    itemCount: { type: Number, default: 0 },
  },
  { _id: false },
);

const vpAttemptSchema = new Schema(
  {
    caseId: { type: Schema.Types.ObjectId, ref: "VirtualPatientCase", required: true, index: true },
    // Язык, на котором врач читал кейс. Нужен при сдаче: диагноз и заключение
    // сверяются со списками ЭТОГО языка, иначе верный ответ по-турецки не
    // засчитывается против русского эталона. Хранится в попытке, а не берётся
    // из запроса: переключение интерфейса между стартом и сдачей не должно
    // менять условия уже идущей попытки.
    lang: { type: String, enum: ["ru", "en", "az", "tr", "ar"], default: "ru" },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Список статусов — общий (constants.js): в нём есть expired.
    status: { type: String, enum: ATTEMPT_STATUSES, default: "in_progress" },
    // Режим, зачётность, лимит времени, сигналы добросовестности — общие для
    // всех станций арены (attemptPolicyFields.js).
    ...attemptPolicyFields(),
    // Какой числовой вариант кейса достался этой попытке (0 — базовый кейс
    // автора). Хранится, чтобы разбор и пересчёт оценки шли по тем же цифрам,
    // которые видел врач.
    variantIndex: { type: Number, default: 0 },
    variantLabel: { type: String, trim: true, maxlength: 60, default: "" },

    // Предварительный дифряд: фиксируется до заказа обследований.
    commitment: { type: commitmentSchema, default: () => ({}) },

    response: {
      ordered: { type: [String], default: [] }, // ключи назначенных обследований
      // Когда именно заказано каждое обследование — путь решения, а не только
      // его итог. По нему видно, шёл ли врач от жалобы к подтверждению.
      orderLog: {
        type: [
          new Schema(
            {
              key: { type: String, required: true },
              at: { type: Date, default: Date.now },
              necessary: { type: Boolean, default: false },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      diagnosisKeys: { type: [String], default: [] },
      // Формулировка диагноза как её написал учащийся: она и оценивается,
      // и нужна в разборе — без неё ответ врача в записи попытки терялся.
      diagnosisText: { type: String, trim: true, maxlength: 4000, default: "" },
      reasoningText: { type: String, trim: true, maxlength: 4000, default: "" },
    },

    score: { type: scoreSchema, default: () => ({}) },
    // Разбор набора: сколько нужных назначено, сколько лишних.
    workupDetail: { type: Schema.Types.Mixed, default: null },
    aiFeedback: { type: Schema.Types.Mixed, default: null },

    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "vp_attempts" },
);

vpAttemptSchema.index({ userId: 1, caseId: 1, status: 1 });

const VirtualPatientAttempt =
  mongoose.models.VirtualPatientAttempt ||
  mongoose.model("VirtualPatientAttempt", vpAttemptSchema, "vp_attempts");

export default VirtualPatientAttempt;
