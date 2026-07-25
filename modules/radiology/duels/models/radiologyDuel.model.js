// server/modules/radiology/duels/models/radiologyDuel.model.js
//
// Асинхронная дуэль 1×1 на кейсе станции «Снимки»: двое проходят ОДИН и тот
// же кейс, у кого балл выше — тот победил. Реального времени нет намеренно:
// вызов «висит» открытым, пока кто-то его не примет.
//
// Жизненный цикл:
//   awaiting_challenger — создатель ещё не прислал свой результат
//   open                — результат создателя есть, ждём соперника
//   completed           — оба прошли, победитель определён

import mongoose from "mongoose";

const { Schema } = mongoose;

const sideSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, default: "Врач" },
    score: { type: Number, default: null }, // 0..1
    attemptId: { type: Schema.Types.ObjectId, ref: "RadiologyAttempt", default: null },
  },
  { _id: false },
);

const radiologyDuelSchema = new Schema(
  {
    caseId: { type: Schema.Types.ObjectId, ref: "RadiologyCase", required: true, index: true },
    caseTitle: { type: String, default: "" },
    modality: { type: String, default: "" },

    challenger: { type: sideSchema, default: () => ({}) },
    opponent: { type: sideSchema, default: () => ({}) },

    status: {
      type: String,
      enum: ["awaiting_challenger", "open", "completed"],
      default: "awaiting_challenger",
      index: true,
    },
    // "challenger" | "opponent" | "draw" | null
    winner: { type: String, default: null },
  },
  { timestamps: true, collection: "radiology_duels" },
);

radiologyDuelSchema.index({ status: 1, createdAt: -1 });

const RadiologyDuel =
  mongoose.models.RadiologyDuel ||
  mongoose.model("RadiologyDuel", radiologyDuelSchema, "radiology_duels");

export default RadiologyDuel;
