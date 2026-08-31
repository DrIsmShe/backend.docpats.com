import Notification from "../../../common/models/Notification/notification.js";
import { emitNotification } from "../../../common/realtime/userChannel.js";
import { tReq } from "../../../common/i18n/index.js";

export const createNotificationController = async (req, res) => {
  try {
    const { userId, type, title, message, link } = req.body;

    const notification = await Notification.create({
      userId,
      type,
      title,
      message,
      link,
    });

    // Личный канал /communication + user:<id> вместо мёртвого global.io.
    emitNotification(userId, notification);

    res.status(201).json({ success: true, notification });
  } catch (err) {
    console.error("Error creating notification:", err);
    res
      .status(500)
      .json({ success: false, message: tReq(req, "app.notification.createError") });
  }
};
