import mongoose from "mongoose";

const { Schema } = mongoose;

export const PARTICIPANT_ROLES = [
  "doctor",
  "patient",
  "admin",
  "assistant",
  "observer",
];

const DialogParticipantSchema = new Schema(
  {
    dialogId: {
      type: Schema.Types.ObjectId,
      ref: "ChatDialog",
      required: true,
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    roleInDialog: {
      type: String,
      enum: PARTICIPANT_ROLES,
      required: true,
      default: "patient",
    },

    // Для подсчёта непрочитанных и статуса "прочитано"
    lastReadMessageId: {
      type: Schema.Types.ObjectId,
      ref: "Message",
    },
    lastReadAt: {
      type: Date,
    },

    // На будущее — индивидуальные настройки
    isMuted: {
      type: Boolean,
      default: false,
    },
    isPinned: {
      type: Boolean,
      default: false,
    },

    // Можно хранить дополнительные настройки/флаги
    settings: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // Soft remove участника
    isRemoved: {
      type: Boolean,
      default: false,
      index: true,
    },
    removedAt: {
      type: Date,
    },
    removedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);
DialogParticipantSchema.statics.markRead = async function ({
  dialogId,
  userId,
  messageId,
}) {
  const update = {
    lastReadAt: new Date(),
  };
  if (messageId) {
    update.lastReadMessageId = messageId;
  }

  await this.updateOne(
    { dialogId, userId },
    { $set: update },
    { upsert: false },
  );
};
// Один пользователь не может быть дважды в одном диалоге
DialogParticipantSchema.index({ dialogId: 1, userId: 1 }, { unique: true });

const DialogParticipantModel =
  mongoose.models.DialogParticipant ||
  mongoose.model(
    "DialogParticipant",
    DialogParticipantSchema,
    "dialogparticipants", // 👈 ЖЁСТКО указываем
  );

export default DialogParticipantModel;
