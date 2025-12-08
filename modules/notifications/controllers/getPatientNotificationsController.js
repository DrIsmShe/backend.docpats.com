import Notification from "../../../common/models/Notification/notification.js";

export const getPatientNotificationsController = async (req, res) => {
  try {
    const userId = req.userId;

    // ✅ Показываем только уведомления, где userId — текущий пользователь
    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    const unreadNotifications = notifications.filter((n) => !n.isRead);
    const readNotifications = notifications.filter((n) => n.isRead);

    return res.json({
      success: true,
      total: notifications.length,
      unreadCount: unreadNotifications.length,
      unreadNotifications,
      readNotifications,
    });
  } catch (err) {
    console.error("❌ Ошибка при получении уведомлений:", err);
    return res.status(500).json({
      success: false,
      message: "Ошибка при загрузке уведомлений",
    });
  }
};
