// server/modules/radiology/virtual-patient/models/vpAttempt.model.js
//
// Попытка режима «Виртуальный пациент». XP начисляется через общий игровой
// слой арены (game.service), поэтому своего профиля нет.

import mongoose from "mongoose";

const { Schema } = mongoose;

const scoreSchema = new Schema(
  {
    total: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    diagnosis: { type: Number, default: null },
    workup: { type: Number, default: null }, // разумность набора обследований
    reasoning: { type: Number, default: null },
  },
  { _id: false },
);

const vpAttemptSchema = new Schema(
  {
    caseId: { type: Schema.Types.ObjectId, ref: "VirtualPatientCase", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ["in_progress", "submitted"], default: "in_progress" },

    response: {
      ordered: { type: [String], default: [] }, // ключи назначенных обследований
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
