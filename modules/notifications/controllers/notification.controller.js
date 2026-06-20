// server/modules/notifications/controllers/notification.controller.js
//
// Единый контроллер уведомлений (Stage 1 / C1).
// Единая форма ответа: { success, items, unreadCount, total }.
// Фильтрует по реальному полю модели — userId (без спекулятивных
// targetUser/doctorProfileId из старого getNotificationsController).
//
// authMiddleware кладёт req.userId.

import * as notificationService from "../services/notification.service.js";

// GET /notifications?status=all|unread|read&limit=&before=
export const list = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }

    const { status = "all", limit, before } = req.query;

    const items = await notificationService.listForUser(userId, {
      status,
      limit: Number(limit) || 50,
      before,
    });
    const unread = await notificationService.unreadCount(userId);

    return res.status(200).json({
      success: true,
      items,
      unreadCount: unread,
      total: items.length,
    });
  } catch (err) {
    console.error("❌ notifications.list:", err);
    return res
      .status(500)
      .json({ success: false, message: "Ошибка загрузки уведомлений" });
  }
};

// GET /notifications/unread-count
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }
    const unread = await notificationService.unreadCount(userId);
    return res.status(200).json({ success: true, unreadCount: unread });
  } catch (err) {
    console.error("❌ notifications.unreadCount:", err);
    return res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
};

// PATCH /notifications/:id/read
export const markRead = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }
    const { id } = req.params;
    const result = await notificationService.markRead(userId, id);
    if (!result.matchedCount) {
      return res
        .status(404)
        .json({ success: false, message: "Уведомление не найдено" });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ notifications.markRead:", err);
    return res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
};

// PATCH /notifications/read-all
export const markAllRead = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }
    const result = await notificationService.markAllRead(userId);
    return res
      .status(200)
      .json({ success: true, modified: result.modifiedCount ?? 0 });
  } catch (err) {
    console.error("❌ notifications.markAllRead:", err);
    return res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
};

// DELETE /notifications/:id
export const remove = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }
    const { id } = req.params;
    const result = await notificationService.remove(userId, id);
    if (!result.deletedCount) {
      return res
        .status(404)
        .json({ success: false, message: "Уведомление не найдено" });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ notifications.remove:", err);
    return res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
};

export default { list, getUnreadCount, markRead, markAllRead, remove };
