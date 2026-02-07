// controllers/markAsReadController.js
import Notification from "../../../common/models/Notification/notification.js";
import mongoose from "mongoose";

/**
 * @desc Отметить одно или все уведомления как прочитанные
 * @route PATCH /notifications/mark-read
 * @access Authenticated
 */
export const markAsReadController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId)
      return res.status(401).json({
        success: false,
        message: "Неавторизованный доступ",
      });

    const { notificationId } = req.body;

    // ✅ Если передан конкретный ID
    if (notificationId) {
      const updated = await Notification.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(notificationId),
          userId: new mongoose.Types.ObjectId(userId),
        },
        { $set: { isRead: true } },
        { new: true }
      );

      if (!updated)
        return res.status(404).json({
          success: false,
          message: "Уведомление не найдено или не принадлежит пользователю",
        });

      return res.json({
        success: true,
        message: "✅ Уведомление помечено как прочитанное",
        notification: updated,
      });
    }

    // ✅ Если ID не передан — обновляем все
    const result = await Notification.updateMany(
      {
        userId: new mongoose.Types.ObjectId(userId),
        isRead: false,
      },
      { $set: { isRead: true } }
    );

    return res.json({
      success: true,
      message: `✅ Все уведомления (${result.modifiedCount}) помечены как прочитанные`,
    });
  } catch (err) {
    console.error("❌ Ошибка при отметке уведомлений:", err);
    res.status(500).json({
      success: false,
      message: "Ошибка сервера при обновлении уведомлений",
      error: err.message,
    });
  }
};
