import Notification from "../../../common/models/Notification/notification.js";
import { tReq } from "../../../common/i18n/index.js";
import { localizeNotifications } from "../services/localize.service.js";

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
      unreadNotifications: localizeNotifications(unreadNotifications, req),
      readNotifications: localizeNotifications(readNotifications, req),
    });
  } catch (err) {
    console.error("❌ Ошибка при получении уведомлений:", err);
    return res.status(500).json({
      success: false,
      message: tReq(req, "app.notification.fetchError"),
    });
  }
};
