import Notification from "../../../common/models/Notification/notification.js";
import { tReq } from "../../../common/i18n/index.js";

export const markSinglePatientNotificationAsReadController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // ✅ Ищем уведомление, где пользователь — либо получатель, либо отправитель
    const notif = await Notification.findOneAndUpdate(
      {
        _id: id,
        $or: [{ userId }, { senderId: userId }],
      },
      { $set: { isRead: true } },
      { new: true }
    );

    if (!notif) {
      return res
        .status(404)
        .json({ success: false, message: tReq(req, "app.notification.notFound") });
    }

    res.json({ success: true, notification: notif });
  } catch (err) {
    console.error("Ошибка при отметке прочитанного:", err);
    res.status(500).json({ success: false, message: tReq(req, "app.server.error") });
  }
};
