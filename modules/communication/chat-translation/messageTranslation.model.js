// server/modules/communication/chat-translation/messageTranslation.model.js
//
// Stores one message translated into one language.
// One document = one message × one target language.
//
// HIPAA §164.312(a)(2)(iv): translation cache holds the SAME PHI as the
// source message (full original text + its translation), so both are now
// encrypted at rest with the canonical helper from message.model.js
// (AES-256-CBC / ENCRYPTION_KEY, "iv:ciphertext" hex).
//
//   originalTextEncrypted   ← full source text, encrypted
//   translatedTextEncrypted ← translated text, encrypted
//
// Legacy plaintext fields (originalText / translatedText) are kept OPTIONAL
// for read back-compat with pre-migration docs; new docs never write them.
// Crypto is applied in the service layer (see messageTranslation.service.js),
// because .select() projections here would otherwise break virtual getters.

import mongoose from "mongoose";

const { Schema } = mongoose;

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
    },

    // ── Legacy plaintext (pre-migration). НЕ required — новые доки сюда не пишут.
    originalText: {
      type: String,
      default: null,
    },

    // ── Зашифрованный оригинал (HIPAA at-rest). "iv:ciphertext" hex, AES-256-CBC.
    originalTextEncrypted: {
      type: String,
      default: null,
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

    // ── Legacy plaintext перевод (pre-migration). НЕ required.
    translatedText: {
      type: String,
      default: null,
    },

    // ── Зашифрованный перевод (HIPAA at-rest). "iv:ciphertext" hex, AES-256-CBC.
    translatedTextEncrypted: {
      type: String,
      default: null,
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
