// server/modules/diagnostics/core/models/diagnosticJob.model.js
//
// ЗАДАНИЕ НА АНАЛИЗ — один запуск одного анализатора по одной модальности.
//
// Главное поле здесь — provenance. Без него вывод модели невозможно ни
// воспроизвести, ни защитить: через полгода на вопрос «почему система так
// сказала» нужно ответить не «ну, ИИ решил», а «модель такая-то, версия
// промпта такая-то, вход такой-то». Это же и делает возможным честное
// сравнение версий: поменяли промпт — видно, где выводы разъехались.
//
// inputHash — отпечаток входных данных (не сами данные): по нему видно, что
// два задания разбирали одно и то же, без хранения PHI в дополнительном месте.

import mongoose from "mongoose";
import { JOB_STATUSES, MODALITY_KEYS } from "../../constants.js";

const { Schema } = mongoose;

const diagnosticJobSchema = new Schema(
  {
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "DiagnosticCase",
      required: true,
      index: true,
    },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    modality: { type: String, enum: MODALITY_KEYS, required: true },
    analyzer: { type: String, required: true },
    artifactIds: { type: [Schema.Types.ObjectId], default: [] },

    status: { type: String, enum: JOB_STATUSES, default: "queued", index: true },
    // Почему пропущено или не выполнено — врачу видно текстом, без гадания.
    message: { type: String, default: "" },

    provenance: {
      model: { type: String, default: "" },
      promptVersion: { type: String, default: "" },
      inputHash: { type: String, default: "" },
      startedAt: { type: Date, default: null },
      finishedAt: { type: Date, default: null },
      durationMs: { type: Number, default: null },
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
    },

    // Сколько выводов дало задание — для списка, без лишнего запроса.
    findingsCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "diagnostic_jobs" },
);

diagnosticJobSchema.index({ caseId: 1, createdAt: -1 });

const DiagnosticJob =
  mongoose.models.DiagnosticJob ||
  mongoose.model("DiagnosticJob", diagnosticJobSchema, "diagnostic_jobs");

export default DiagnosticJob;
