import Notification from "../../../common/models/Notification/notification.js";

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

    // Если Socket.io подключен:
    if (global.io) {
      global.io.to(userId.toString()).emit("new_notification", notification);
    }

    res.status(201).json({ success: true, notification });
  } catch (err) {
    console.error("Error creating notification:", err);
    res
      .status(500)
      .json({ success: false, message: "Ошибка при создании уведомления" });
  }
};
