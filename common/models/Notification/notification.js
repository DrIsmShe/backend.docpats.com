import mongoose from "mongoose";

// 🔹 Схема уведомлений
const notificationSchema = new mongoose.Schema(
  {
    // 🧩 Получатель уведомления (всегда конкретный пользователь)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // 🧩 Отправитель (например, врач, пациент, админ)
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // 🔹 Ссылка на объект (например, приём, статья, профиль)
    link: {
      type: String,
      trim: true,
      default: null,
    },

    // 🔹 Тип уведомления — удобно для фильтрации и UI
    type: {
      type: String,
      enum: [
        "appointment_booked", // Пациент записался
        "appointment_cancelled", // Отмена записи
        "appointment_confirmed", // Врач подтвердил
        "appointment_completed", // Завершено
        "appointment_reminder", // Напоминание
        "system_message", // Системное уведомление
        "comment", // Комментарий
        "comment_reply", // ✅ добавь
        "comment_doctor", // ✅ добавь
        "comment_reply_in_article", // ✅ добавь
        "like", // Лайк / реакция
        "friend_request", // Новый контакт
        "payment", // Оплата
        "custom", // Любое произвольное уведомление
        "doctorProfile.commented", // ✅ добавь эту строку
        "doctorProfile.commented",
        "doctorProfile.replied",
        "doctorProfile.commentSent", // ✅ добавь эту строку
      ],
      default: "system_message",
      required: true,
    },

    // 🔹 Заголовок уведомления
    title: {
      type: String,
      required: true,
      trim: true,
    },

    // 🔹 Основной текст уведомления
    message: {
      type: String,
      required: true,
      trim: true,
    },

    // 🔹 Прочитано / не прочитано
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    // 🔹 Приоритет (для push и сортировки)
    priority: {
      type: String,
      enum: ["low", "normal", "high"],
      default: "normal",
    },

    // 🔹 Иконка для отображения
    icon: {
      type: String,
      default: "bell",
    },
  },
  {
    timestamps: true,
  }
);

// 🔸 Индексы для быстрого поиска

notificationSchema.index(
  { userId: 1, senderId: 1, type: 1, message: 1 },
  { unique: true, sparse: true }
);

notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });

// 🔸 Статические методы
notificationSchema.statics.markAsRead = async function (userId, id = null) {
  if (id) {
    return this.updateOne({ _id: id, userId }, { $set: { isRead: true } });
  }
  return this.updateMany({ userId, isRead: false }, { $set: { isRead: true } });
};

// 🔸 Виртуальное поле для форматированной даты
notificationSchema.virtual("formattedDate").get(function () {
  return new Date(this.createdAt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
});

// ✅ Экспорт модели
export default mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);
