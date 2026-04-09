// server/modules/communication/chat-translation/messageTranslation.model.js

import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Хранит переведённый текст одного сообщения на один язык.
 * Один документ = одно сообщение × один целевой язык.
 *
 * Пример: сообщение "Как вы себя чувствуете?" переведено на "en" → "How are you feeling?"
 */
const MessageTranslationSchema = new Schema(
  {
    // Ссылка на оригинальное сообщение
    messageId: {
      type: Schema.Types.ObjectId,
      ref: "ChatMessage",
      required: true,
      index: true,
    },

    // Диалог — для быстрой очистки при удалении диалога
    dialogId: {
      type: Schema.Types.ObjectId,
      ref: "ChatDialog",
      required: true,
      index: true,
    },

    // Оригинальный текст (копируем чтобы не делать join при отдаче)
    originalText: {
      type: String,
      required: true,
    },

    // Определённый язык оригинала (ru, en, az, tr, ar, ...)
    detectedLang: {
      type: String,
      trim: true,
      default: null,
    },

    // Целевой язык перевода
    targetLang: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // Переведённый текст
    translatedText: {
      type: String,
      required: true,
    },

    // Метод перевода
    translationMethod: {
      type: String,
      enum: ["openai_gpt4o_mini", "manual"],
      default: "openai_gpt4o_mini",
    },

    // Кто запросил перевод (userId — для аудита, необязательно)
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Был ли перевод prefetch (автоматически при отправке) или on-demand
    isPrefetch: {
      type: Boolean,
      default: false,
      index: true,
    },

    // Количество запросов этого перевода (для аналитики популярных языков)
    hitCount: {
      type: Number,
      default: 1,
    },

    // TTL — MongoDB автоматически удалит документ через 90 дней
    // (старые переводы не нужны)
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 }, // TTL index
    },
  },
  {
    timestamps: true, // createdAt / updatedAt
  },
);

// ─── Индексы ──────────────────────────────────────────────────────────────────

// Основной: найти перевод сообщения на язык — самый частый запрос
MessageTranslationSchema.index(
  { messageId: 1, targetLang: 1 },
  { unique: true },
);

// Для очистки переводов при удалении диалога
MessageTranslationSchema.index({ dialogId: 1 });

// ─── Модель ───────────────────────────────────────────────────────────────────

const MessageTranslationModel =
  mongoose.models.MessageTranslation ||
  mongoose.model(
    "MessageTranslation",
    MessageTranslationSchema,
    "message_translations",
  );

export default MessageTranslationModel;
