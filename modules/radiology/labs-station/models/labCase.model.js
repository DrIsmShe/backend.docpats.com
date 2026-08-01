// server/modules/radiology/labs-station/models/labCase.model.js
//
// LabCase — учебный кейс станции «Анализы»: клинический контекст + панель
// лабораторных результатов + эталон (какие показатели значимо отклонены и
// какой диагноз). Вторая станция «Диагностической арены» после снимков.
//
// Значение показателя храним строкой — панель бывает и качественной
// («положительный», «следы»), не только числовой. «Норма/отклонение»
// определяет автор списком significantAbnormal, а не сравнением с диапазоном:
// не всякое отклонение от референса клинически значимо.

import mongoose from "mongoose";
import { aiReviewField } from "../../ai/aiReviewFields.js";
import {
  DIFFICULTIES,
  CASE_STATUSES,
  SOURCE_KINDS,
} from "../../constants.js";

const { Schema } = mongoose;

const panelItemSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    value: { type: String, required: true, trim: true, maxlength: 60 },
    unit: { type: String, trim: true, maxlength: 40, default: "" },
    refRange: { type: String, trim: true, maxlength: 60, default: "" }, // «3.5–5.1»
  },
  { _id: false },
);

const impressionSchema = new Schema(
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

const labCaseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    clinicalContext: { type: String, trim: true, maxlength: 4000, default: "" },
    difficulty: { type: String, enum: DIFFICULTIES, default: "medium", index: true },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "ExamCategory",
      default: null,
    },

    // ─── Панель результатов (видна учащемуся) ───
    panel: { type: [panelItemSchema], default: [] },

    // ─── Числовые варианты того же кейса ───
    // Тот же диагноз, другие значения панели. Нужны против передачи ответов:
    // «в этом кейсе значимы гемоглобин и ферритин» перестаёт работать, если у
    // соседа другие цифры, а при повторном зачёте вариант меняется.
    //
    // Ключи показателей ОБЯЗАНЫ совпадать с основной панелью: вариант — это
    // переопределение значений, а не другой кейс. Иначе разошлись бы разбор,
    // статистика и эталон.
    variants: {
      type: [
        new Schema(
          {
            label: { type: String, trim: true, maxlength: 60, default: "" },
            panel: {
              type: [
                new Schema(
                  {
                    key: { type: String, required: true, trim: true, maxlength: 40 },
                    value: { type: String, required: true, trim: true, maxlength: 60 },
                    unit: { type: String, trim: true, maxlength: 40, default: "" },
                    refRange: { type: String, trim: true, maxlength: 60, default: "" },
                  },
                  { _id: false },
                ),
              ],
              default: [],
            },
            // Значимые отклонения ЭТОГО варианта: при других цифрах значимым
            // может стать другой показатель.
            significantAbnormal: { type: [String], default: [] },
            note: { type: String, trim: true, maxlength: 500, default: "" },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    // ─── Эталон (учащемуся не отдаётся до сдачи) ───
    // Ключи показателей, которые учащийся ДОЛЖЕН отметить как значимо
    // отклонённые.
    significantAbnormal: { type: [String], default: [] },
    impression: { type: impressionSchema, default: () => ({}) },

    source: { type: sourceSchema, required: true },

    // Ночная автогенерация (jobs/radiologyDailyCases.job.js). Отдельное поле,
    // а не тег: по нему считается очередь неразобранных автокейсов и
    // определяются уже пройденные темы программы.
    autoGen: {
      isAuto: { type: Boolean, default: false, index: true },
      topicKey: { type: String, trim: true, maxlength: 80, default: "" },
      generatedAt: { type: Date, default: null },
      model: { type: String, trim: true, maxlength: 120, default: "" },
      // Опубликован ли кейс автоматически (рецензент-ИИ не нашёл замечаний).
      autoPublished: { type: Boolean, default: false },
    },

    status: { type: String, enum: CASE_STATUSES, default: "draft", index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    publishedAt: { type: Date, default: null },

    // Лимит времени зачётной попытки, секунды. null — значение по станции из
    // attemptPolicy.DEFAULT_TIME_LIMIT_SEC; в тренировке лимита нет.
    timeLimitSec: { type: Number, default: null, min: 30, max: 7200 },

    // Типовой ответ чат-бота на кейс — для сигнала дословного переноса.
    aiBaseline: {
      text: { type: String, default: "" },
      model: { type: String, default: "" },
      generatedAt: { type: Date, default: null },
    },

    // Сохранённая ИИ-рецензия второго прохода и отметки «разобрано».
    // Лежит в кейсе, а не в состоянии формы: гейт публикации опирается на
    // разбор замечаний, а состояние React живёт до перезагрузки страницы.
    ...aiReviewField(),

    stats: {
      attempts: { type: Number, default: 0 }, // все сдачи, включая тренировки
      avgScore: { type: Number, default: 0 }, // ТОЛЬКО первые зачётные
      countedAttempts: { type: Number, default: 0 },
      avgDurationMs: { type: Number, default: null },
    },
  },
  { timestamps: true, collection: "lab_cases" },
);

labCaseSchema.index({ status: 1, difficulty: 1 });

const LabCase =
  mongoose.models.LabCase ||
  mongoose.model("LabCase", labCaseSchema, "lab_cases");

export default LabCase;
