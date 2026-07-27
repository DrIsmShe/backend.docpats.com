// server/modules/diagnostics/core/models/diagnosticFinding.model.js
//
// ВЫВОД — то, на что система предлагает обратить внимание.
//
// Три правила зашиты прямо в модель:
//
// 1. advisory всегда true и менять его нельзя. Вывод — подсказка, а не
//    диагноз. Поле существует, чтобы это ехало вместе с данными в API, в
//    выгрузку и в любую интеграцию, а не жило только в тексте интерфейса.
// 2. verdict — что сказал ВРАЧ. Это одновременно и обратная связь, и разметка
//    будущего датасета: «согласен / частично / не согласен» с поправкой.
//    Именно ради этого поля модуль имеет смысл строить рано.
// 3. Тексты шифруются: вывод пересказывает данные пациента.

import mongoose from "mongoose";
import {
  CONFIDENCE_LEVELS,
  FINDING_SEVERITIES,
  FINDING_VERDICTS,
  MODALITY_KEYS,
} from "../../constants.js";
import { encryptPHI, decryptPHI } from "../../../../common/utils/phiCrypto.js";

const { Schema } = mongoose;

const diagnosticFindingSchema = new Schema(
  {
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "DiagnosticCase",
      required: true,
      index: true,
    },
    jobId: { type: Schema.Types.ObjectId, ref: "DiagnosticJob", required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    modality: { type: String, enum: MODALITY_KEYS, required: true },

    title: { type: String, default: "", set: encryptPHI, get: decryptPHI },
    detail: { type: String, default: "", set: encryptPHI, get: decryptPHI },
    severity: { type: String, enum: FINDING_SEVERITIES, default: "note", index: true },
    confidence: { type: String, enum: CONFIDENCE_LEVELS, default: "moderate" },
    // Пункт протокола, к которому относится вывод: врачу видно, что разбор шёл
    // по чек-листу, а не по наитию.
    checklistItem: { type: String, default: "" },

    // Что предлагается сделать: уточнить, дообследовать, перепроверить.
    recommendations: { type: [String], default: [], set: (v) => (v ?? []).map(encryptPHI) },
    // Источник утверждения, если модель его назвала. Не проверяем автоматически
    // — показываем врачу как есть и честно помечаем, что ссылка не верифицирована.
    citations: {
      type: [
        new Schema(
          {
            source: { type: String, default: "" },
            note: { type: String, default: "" },
            verified: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    // Неизменяемо: вывод не может стать «не рекомендательным».
    advisory: { type: Boolean, default: true, immutable: true },

    // ─── Обратная связь врача (она же — разметка) ───
    verdict: { type: String, enum: FINDING_VERDICTS, default: "pending", index: true },
    verdictAt: { type: Date, default: null },
    correction: { type: String, default: "", set: encryptPHI, get: decryptPHI },
  },
  {
    timestamps: true,
    collection: "diagnostic_findings",
    toJSON: { getters: true },
    toObject: { getters: true },
  },
);

// Рекомендации шифруются массивом — геттер тоже нужен массиву.
diagnosticFindingSchema.path("recommendations").get((v) => (v ?? []).map(decryptPHI));

diagnosticFindingSchema.index({ caseId: 1, severity: 1, createdAt: 1 });

const DiagnosticFinding =
  mongoose.models.DiagnosticFinding ||
  mongoose.model("DiagnosticFinding", diagnosticFindingSchema, "diagnostic_findings");

export default DiagnosticFinding;
