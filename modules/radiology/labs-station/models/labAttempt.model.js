// server/modules/radiology/labs-station/models/labAttempt.model.js
//
// Попытка на станции «Анализы». Зеркалит RadiologyAttempt по духу: ответ +
// покомпонентная оценка + разбор. Начисление XP идёт через общий игровой
// слой арены (game.service), поэтому отдельного «профиля» здесь нет.

import mongoose from "mongoose";

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
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ["in_progress", "submitted"], default: "in_progress" },

    response: {
      // Ключи показателей, которые учащийся отметил как отклонённые.
      flags: { type: [String], default: [] },
      impressionText: { type: String, trim: true, maxlength: 4000, default: "" },
      diagnosisKeys: { type: [String], default: [] },
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
