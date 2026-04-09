import mongoose from "mongoose";

// 🔹 Схема уведомлений
const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    link: {
      type: String,
      trim: true,
      default: null,
    },
    type: {
      type: String,
      enum: [
        "appointment_booked",
        "appointment_cancelled",
        "appointment_confirmed",
        "appointment_completed",
        "appointment_reminder",
        "system_message",
        "comment",
        "comment_reply",
        "comment_doctor",
        "comment_reply_in_article",
        "like",
        "friend_request",
        "payment",
        "custom",
        "doctorProfile.commented",
        "doctorProfile.replied",
        "doctorProfile.commentSent",
        "chat_message", // ← новый тип для сообщений чата
      ],
      default: "system_message",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high"],
      default: "normal",
    },
    icon: {
      type: String,
      default: "bell",
    },
  },
  {
    timestamps: true,
  },
);

notificationSchema.index(
  { userId: 1, senderId: 1, type: 1, message: 1 },
  { unique: true, sparse: true },
);
notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });

notificationSchema.statics.markAsRead = async function (userId, id = null) {
  if (id) {
    return this.updateOne({ _id: id, userId }, { $set: { isRead: true } });
  }
  return this.updateMany({ userId, isRead: false }, { $set: { isRead: true } });
};

notificationSchema.virtual("formattedDate").get(function () {
  return new Date(this.createdAt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
});

export default mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);
