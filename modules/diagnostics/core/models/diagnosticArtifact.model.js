// server/modules/diagnostics/core/models/diagnosticArtifact.model.js
//
// АРТЕФАКТ — то, что врач принёс: текст, заключение, панель анализов, снимок,
// PDF, видео. Один артефакт = один материал.
//
// Два решения, которые стоит объяснить:
//
// 1. Текст артефакта шифруется, а структурированные данные (панель анализов) —
//    нет. Панель — это ключи показателей и числа; по ней надо считать правилами
//    и искать, а PHI в ней нет (имя пациента в панель не кладём).
// 2. Имя исходного файла тоже шифруется. В медицине файл почти всегда
//    называется «Иванов_КТ_2026.pdf» — это PHI, и хранить его открытым нельзя.

import mongoose from "mongoose";
import { ARTIFACT_KINDS, MODALITY_KEYS } from "../../constants.js";
import { encryptPHI, decryptPHI } from "../../../../common/utils/phiCrypto.js";

const { Schema } = mongoose;

const diagnosticArtifactSchema = new Schema(
  {
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "DiagnosticCase",
      required: true,
      index: true,
    },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    kind: { type: String, enum: ARTIFACT_KINDS, required: true },
    // К какой модальности относится материал. Может быть пустым: врач не всегда
    // знает, куда отнести выписку, — тогда его разберёт клинический подмодуль.
    modality: { type: String, enum: [...MODALITY_KEYS, ""], default: "" },

    // Файл в хранилище (R2). Для текстовых артефактов пусто.
    url: { type: String, default: "" },
    mime: { type: String, default: "" },
    sizeBytes: { type: Number, default: null },
    fileName: { type: String, default: "", set: encryptPHI, get: decryptPHI },

    // Текст: введённый врачом или извлечённый из документа.
    text: { type: String, default: "", set: encryptPHI, get: decryptPHI },

    // Структурированные данные. Для панели анализов:
    // { items: [{ key, name, value, unit, refLow, refHigh, refText }] }
    structured: { type: Schema.Types.Mixed, default: null },

    // Подтверждено ли, что материал обезличен. Проверяется перед анализом.
    deidentified: { type: Boolean, default: false },
    // Заметка врача к материалу («снимок плохого качества»).
    note: { type: String, default: "", set: encryptPHI, get: decryptPHI },
  },
  {
    timestamps: true,
    collection: "diagnostic_artifacts",
    toJSON: { getters: true },
    toObject: { getters: true },
  },
);

diagnosticArtifactSchema.index({ caseId: 1, createdAt: 1 });

const DiagnosticArtifact =
  mongoose.models.DiagnosticArtifact ||
  mongoose.model("DiagnosticArtifact", diagnosticArtifactSchema, "diagnostic_artifacts");

export default DiagnosticArtifact;
