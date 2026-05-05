import mongoose from "mongoose";
import {
  encrypt,
  safeDecrypt,
} from "../../simulation/services/encryption.service.js";

const { Schema } = mongoose;

export const MESSAGE_TYPES = [
  "text",
  "file",
  "image",
  "video",
  "voice",
  "system",
];

const MessageSchema = new Schema(
  {
    dialogId: {
      type: Schema.Types.ObjectId,
      ref: "ChatDialog",
      required: true,
      index: true,
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatMessage",
      default: null,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: MESSAGE_TYPES,
      required: true,
      default: "text",
      index: true,
    },

    // ── Legacy поле (plain text). Оставляем временно для backward compat:
    // старые сообщения в БД лежат тут. После полной миграции и cleanup-скрипта
    // это поле будет удалено из всех документов.
    text: {
      type: String,
      trim: true,
    },

    // ── Зашифрованный текст (HIPAA § 164.312(a)(2)(iv) — encryption at rest).
    // Формат: "iv:authTag:ciphertext" (все hex), AES-256-GCM.
    // Ключ: SURGERY_ENCRYPTION_KEY из env.
    textEncrypted: {
      type: String,
      default: null,
    },

    // Ответ на другое сообщение (threading / reply)
    replyToMessageId: {
      type: Schema.Types.ObjectId,
      ref: "ChatMessage",
    },

    // Для системных сообщений — код события
    systemCode: {
      type: String,
      trim: true,
    },

    // На будущее — метаданные
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // Реакции на сообщение (эмодзи от участников)
    reactions: [
      {
        emoji: { type: String, required: true },
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      },
    ],

    // Кто прочитал сообщение
    readBy: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        readAt: { type: Date, default: Date.now },
      },
    ],

    // Soft delete сообщения
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// ─── Virtual "decryptedText" ───────────────────────────────────────────────
// Read-only: возвращает дешифрованный текст ИЛИ legacy plain `text`.
// Используется в mapper: msg.decryptedText. НИКОГДА не возвращает зашифрованную
// строку наружу.
//
// safeDecrypt — если расшифровка упала (битая запись, смена ключа без
// миграции), возвращаем "" вместо краша всего ответа.
MessageSchema.virtual("decryptedText").get(function () {
  if (this.textEncrypted) return safeDecrypt(this.textEncrypted, "");
  return this.text || null;
});

MessageSchema.set("toJSON", { virtuals: true });
MessageSchema.set("toObject", { virtuals: true });

MessageSchema.virtual("attachments", {
  ref: "MessageAttachment",
  localField: "_id",
  foreignField: "messageId",
});

const ChatMessageModel =
  mongoose.models.ChatMessage ||
  mongoose.model("ChatMessage", MessageSchema, "messages");

// ─── Helper для service слоя ────────────────────────────────────────────────
// Шифрует plain text → возвращает payload для записи в textEncrypted.
// Service использует это перед .create() / .save().
export function encryptMessageText(plainText) {
  if (!plainText || typeof plainText !== "string" || !plainText.trim()) {
    return null;
  }
  return encrypt(plainText);
}

export default ChatMessageModel;
