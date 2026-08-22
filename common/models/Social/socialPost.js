// common/models/Social/socialPost.js
//
// Что уже опубликовано в собственных каналах. Одна запись = один
// материал в одном канале.
//
// Без этой памяти job при каждом прогоне видел бы одни и те же свежие
// материалы и постил их снова — канал превратился бы в повтор одного и
// того же поста каждые полчаса.
//
// Ключ составной (channel + refUrl): один материал может уходить в
// несколько каналов, и уже отправленный в Telegram не должен считаться
// отправленным везде.

import mongoose from "mongoose";

const socialPostSchema = new mongoose.Schema(
  {
    channel: { type: String, required: true }, // "telegram"
    refUrl: { type: String, required: true }, // публичный URL материала
    title: { type: String, default: "" },
    postedAt: { type: Date, default: Date.now },
  },
  { collection: "social_posts" },
);

socialPostSchema.index({ channel: 1, refUrl: 1 }, { unique: true });

export default mongoose.models.SocialPost ||
  mongoose.model("SocialPost", socialPostSchema);
