import mongoose from "mongoose";

const { Schema } = mongoose;

export const DIALOG_TYPES = [
  "private", // обычный личный чат
  "group", // групповой
  "doctor_patient", // доктор ↔ пациент
  "doctor_doctor", // доктор ↔ доктор
  "system", // системный
];

const DialogSchema = new Schema(
  {
    type: {
      type: String,
      enum: DIALOG_TYPES,
      required: true,
      default: "private",
      index: true,
    },
    participantsKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    // кто создал диалог
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // последнее сообщение (для быстрого списка)
    lastMessageId: {
      type: Schema.Types.ObjectId,
      ref: "ChatMessage",
      default: null,
    },

    lastMessageAt: {
      type: Date,
      default: null,
      index: true,
    },

    lastMessagePreview: {
      type: String,
      trim: true,
      default: null,
    },

    // если это групповой чат
    title: {
      type: String,
      trim: true,
      default: null,
    },

    avatarUrl: {
      type: String,
      trim: true,
      default: null,
    },

    // дополнительные настройки
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // soft delete диалога
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true, // createdAt / updatedAt
  },
);

// Индексы для быстрых выборок
DialogSchema.index({ createdBy: 1, createdAt: -1 });
DialogSchema.index({ lastMessageAt: -1 });

// Защита от OverwriteModelError
const DialogModel =
  mongoose.models.ChatDialog ||
  mongoose.model("ChatDialog", DialogSchema, "dialogs");

export default DialogModel;
