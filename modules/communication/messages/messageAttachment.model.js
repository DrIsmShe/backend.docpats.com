// server/modules/communication/messages/messageAttachment.model.js
import mongoose from "mongoose";

const { Schema } = mongoose;

export const ATTACHMENT_TYPES = ["file", "voice"];

const MessageAttachmentSchema = new Schema(
  {
    messageId: {
      type: Schema.Types.ObjectId,
      ref: "ChatMessage", // имя модели сообщений
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ATTACHMENT_TYPES,
      required: true,
      default: "file",
    },

    // провайдер хранилища (на будущее)
    storageProvider: {
      type: String,
      default: "local",
    },

    // ключ в хранилище (можем сделать не обязательным, чтобы сейчас не валилось)
    storageKey: {
      type: String,
      required: false,
      trim: true,
    },

    // публичный URL (может быть пустым)
    url: {
      type: String,
      trim: true,
    },

    mimeType: {
      type: String,
      trim: true,
    },

    fileSizeBytes: {
      type: Number,
      min: 0,
    },

    originalName: {
      type: String,
      trim: true,
    },

    // только для voice
    durationMs: {
      type: Number,
      min: 0,
    },

    // любые доп. данные
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // soft delete
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

// индексы
MessageAttachmentSchema.index({ messageId: 1, isDeleted: 1 });
MessageAttachmentSchema.index({ type: 1, createdAt: -1 });

// ⚠️ ВАЖНО: имя модели именно "MessageAttachment"
const MessageAttachmentModel =
  mongoose.models.MessageAttachment ||
  mongoose.model(
    "MessageAttachment",
    MessageAttachmentSchema,
    "message_attachments",
  );

export default MessageAttachmentModel;
