import Notification from "../../../common/models/Notification/notification.js";

export const markAllPatientNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.userId;

    // ✅ Обновляем все уведомления, где пользователь — либо получатель, либо отправитель
    await Notification.updateMany(
      {
        $or: [{ userId }, { senderId: userId }],
        isRead: false,
      },
      { $set: { isRead: true } }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка при отметке всех уведомлений:", err);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
};
