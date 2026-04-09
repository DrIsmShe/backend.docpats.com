import mongoose from "mongoose";

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

    // Основной текст (для file/voice может быть подписью)
    text: {
      type: String,
      trim: true,
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

export default ChatMessageModel;
