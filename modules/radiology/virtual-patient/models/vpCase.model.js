// server/modules/radiology/virtual-patient/models/vpCase.model.js
//
// VirtualPatientCase — флагманский режим арены. Клинический сценарий, где
// игрок ведёт диагностику как врач: видит жалобу, ЗАКАЗЫВАЕТ обследования
// (осмотр, анализы, снимки) и ставит диагноз. Учит не только «читать»
// исследование, но и решать, какое назначить.
//
// Результаты обследований встроены в кейс (self-contained), а не ссылаются
// на кейсы других станций — так автор пишет цельный сценарий, а игрок не
// уходит со страницы.

import mongoose from "mongoose";
import { aiReviewField, aiRevisionField } from "../../ai/aiReviewFields.js";
import { agentRunField } from "../../ai/agentRunFields.js";
import { DIFFICULTIES, CASE_STATUSES, SOURCE_KINDS } from "../../constants.js";

const { Schema } = mongoose;

// Одно доступное обследование. necessary — нужно ли его было назначить
// (эталон); на этом держится оценка «разумного набора».
const investigationSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 160 }, // «Общий анализ крови»
    category: { type: String, trim: true, maxlength: 60, default: "" }, // «Лаборатория» / «Лучевая» / «Осмотр»
    // Результат раскрывается, когда игрок «назначает» обследование.
    resultText: { type: String, trim: true, maxlength: 4000, default: "" },
    imageUrl: { type: String, trim: true, maxlength: 1000, default: null }, // для лучевых
    necessary: { type: Boolean, default: false },
  },
  { _id: false },
);

const diagnosisSchema = new Schema(
  {
    correctText: { type: String, trim: true, maxlength: 4000, default: "" },
    diagnosisKeys: { type: [String], default: [] },
    diagnosisSynonyms: { type: [String], default: [] },
  },
  { _id: false },
);

const sourceSchema = new Schema(
  {
    kind: { type: String, enum: SOURCE_KINDS, required: true },
    authority: { type: String, trim: true, maxlength: 300, default: null },
    url: { type: String, trim: true, maxlength: 1000, default: null },
    licenseNote: { type: String, trim: true, maxlength: 2000, default: null },
  },
  { _id: false },
);

const vpCaseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    // Жалоба и вводная — видны сразу.
    presentation: { type: String, trim: true, maxlength: 4000, default: "" },
    difficulty: { type: String, enum: DIFFICULTIES, default: "medium", index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "ExamCategory", default: null },

    investigations: { type: [investigationSchema], default: [] },
    diagnosis: { type: diagnosisSchema, default: () => ({}) },

    // ─── Варианты того же сценария ───
    // Тот же диагноз, другая подача: другие цифры в жалобе и в результатах
    // обследований. Против передачи ответов между врачами и против того, что
    // повторный зачёт — это тот же текст слово в слово.
    //
    // Список нужных обследований (necessary) вариант НЕ меняет: меняются
    // значения, а не логика разбора. results переопределяют resultText по
    // ключу существующего обследования.
    variants: {
      type: [
        new Schema(
          {
            label: { type: String, trim: true, maxlength: 60, default: "" },
            presentation: { type: String, trim: true, maxlength: 4000, default: "" },
            results: {
              type: [
                new Schema(
                  {
                    key: { type: String, required: true, trim: true, maxlength: 40 },
                    resultText: { type: String, trim: true, maxlength: 4000, default: "" },
                  },
                  { _id: false },
                ),
              ],
              default: [],
            },
            note: { type: String, trim: true, maxlength: 500, default: "" },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    source: { type: sourceSchema, required: true },

    // Ночная автогенерация (jobs/radiologyDailyCases.job.js) — см. одноимённое
    // поле у LabCase и RadiologyCase.
    autoGen: {
      isAuto: { type: Boolean, default: false, index: true },
      topicKey: { type: String, trim: true, maxlength: 80, default: "" },
      generatedAt: { type: Date, default: null },
      model: { type: String, trim: true, maxlength: 120, default: "" },
      autoPublished: { type: Boolean, default: false },
    },

    status: { type: String, enum: CASE_STATUSES, default: "draft", index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    publishedAt: { type: Date, default: null },

    // Лимит времени зачётной попытки, секунды. null — значение по станции из
    // attemptPolicy.DEFAULT_TIME_LIMIT_SEC; в тренировке лимита нет.
    timeLimitSec: { type: Number, default: null, min: 30, max: 7200 },

    // Типовой ответ чат-бота на сценарий — для сигнала дословного переноса.
    aiBaseline: {
      text: { type: String, default: "" },
      model: { type: String, default: "" },
      generatedAt: { type: Date, default: null },
    },

    // Сохранённая ИИ-рецензия второго прохода и отметки «разобрано».
    // Лежит в кейсе, а не в состоянии формы: гейт публикации опирается на
    // разбор замечаний, а состояние React живёт до перезагрузки страницы.
    ...aiReviewField(),

    // След цикла «правка → перепроверка» (ai/autoFix.js): что машина
    // исправила по замечаниям рецензента и с чем не согласилась.
    ...aiRevisionField(),

    // Состояние фонового прогона агента (ai/agentRunFields.js).
    ...agentRunField(),

    stats: {
      attempts: { type: Number, default: 0 }, // все сдачи, включая тренировки
      avgScore: { type: Number, default: 0 }, // ТОЛЬКО первые зачётные
      countedAttempts: { type: Number, default: 0 },
      avgDurationMs: { type: Number, default: null },
    },
  },
  { timestamps: true, collection: "vp_cases" },
);

vpCaseSchema.index({ status: 1, difficulty: 1 });

const VirtualPatientCase =
  mongoose.models.VirtualPatientCase ||
  mongoose.model("VirtualPatientCase", vpCaseSchema, "vp_cases");

export default VirtualPatientCase;
