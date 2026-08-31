import Notification from "../../../common/models/Notification/notification.js";
import { tReq } from "../../../common/i18n/index.js";

export const deleteNotificationController = async (req, res) => {
  try {
    const { id } = req.params;

    // Проверим, что уведомление существует и принадлежит пользователю
    const notification = await Notification.findOne({
      _id: id,
      userId: req.userId, // ✅ чтобы врач не удалял чужие уведомления
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: tReq(req, "app.notification.notFoundOrForbidden"),
      });
    }

    await Notification.findByIdAndDelete(id);

    return res.json({
      success: true,
      message: tReq(req, "app.notification.deleteSuccess"),
    });
  } catch (err) {
    console.error("Ошибка при удалении уведомления:", err);
    res
      .status(500)
      .json({ success: false, message: tReq(req, "app.notification.deleteError") });
  }
};
