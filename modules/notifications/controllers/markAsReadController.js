// controllers/markAsReadController.js
import Notification from "../../../common/models/Notification/notification.js";
import mongoose from "mongoose";
import { tReq } from "../../../common/i18n/index.js";
import { errorText } from "../../../common/i18n/index.js";
import { localizeNotification } from "../services/localize.service.js";

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
        message: tReq(req, "app.access.unauthorized"),
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
          message: tReq(req, "app.notification.notFoundOrNotOwned"),
        });

      return res.json({
        success: true,
        message: tReq(req, "app.notification.markReadSuccess"),
        notification: localizeNotification(updated, req),
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
      message: tReq(req, "app.notification.allMarkedRead", {
        count: result.modifiedCount,
      }),
    });
  } catch (err) {
    console.error("❌ Ошибка при отметке уведомлений:", err);
    res.status(500).json({
      success: false,
      message: tReq(req, "app.notification.updateServerError"),
      error: errorText(err, req),
    });
  }
};
