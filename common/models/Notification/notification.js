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
        "chat_message",
        "consent_request_new",
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

// ─── Indexes ─────────────────────────────────────────────────────────────
//
// IMPORTANT — history:
//   This schema USED to carry
//     index({ userId, senderId, type, message }, { unique: true, sparse: true })
//   as a "dedupe" guard. It was wrong and silently LOST notifications:
//   userId/type/message are required and senderId has a default, so the keys
//   are always present → `sparse` never excludes anything → the index behaved
//   as a FULL unique. Any two legitimately-distinct notifications that happened
//   to share (userId, senderId, type, message) — e.g. two "lab result ready"
//   on the same day, or two short "ok" chat pings — collided with E11000 and,
//   if the error was swallowed, the second one was never created.
//
//   A notification is an EVENT LOG entry, not a unique entity: the same text
//   can legitimately arrive many times. So uniqueness is removed. If a specific
//   caller needs anti-double-fire, it does an explicit recent-window check in
//   notify() (see notification.service.js) — that is intentional and scoped,
//   not a blanket DB constraint.
//
//   The old unique index must be DROPPED in the DB by migration — Mongoose
//   does NOT drop removed indexes automatically. See the migration note below.

// Fast unread-list / list-by-recipient queries: recipient + recency.
notificationSchema.index({ userId: 1, createdAt: -1 });
// Unread filter per recipient.
notificationSchema.index({ userId: 1, isRead: 1 });
// Global recency (admin / cleanup).
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
