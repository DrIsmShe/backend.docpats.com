// server/modules/radiology/game/radiologyPlayer.model.js
//
// Игровой профиль «Диагностической арены»: тонкий слой поверх попыток
// (RadiologyAttempt). Очки, ранг и серия дней копятся здесь, чтобы не
// пересчитывать их из всей истории на каждый запрос лидерборда.
//
// Один профиль на пользователя (userId уникален). НЕ содержит PHI.

import mongoose from "mongoose";

const { Schema } = mongoose;

const radiologyPlayerSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    xp: { type: Number, default: 0, index: true },
    casesCompleted: { type: Number, default: 0 },
    bestScore: { type: Number, default: 0 }, // 0..1, лучший балл попытки

    // Серия дней подряд с хотя бы одной сданной попыткой.
    streak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    // День последней активности в формате YYYY-MM-DD (UTC) — по нему решаем,
    // продолжается серия, сбрасывается или уже засчитана сегодня.
    lastPlayedDay: { type: String, default: null },

    // Разблокированные достижения (ключи из ACHIEVEMENTS в game.service).
    achievements: { type: [String], default: [] },
  },
  { timestamps: true, collection: "radiology_players" },
);

const RadiologyPlayer =
  mongoose.models.RadiologyPlayer ||
  mongoose.model("RadiologyPlayer", radiologyPlayerSchema, "radiology_players");

export default RadiologyPlayer;
