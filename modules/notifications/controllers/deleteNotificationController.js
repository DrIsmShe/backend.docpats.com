import Notification from "../../../common/models/Notification/notification.js";

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
        message: "Уведомление не найдено или доступ запрещён",
      });
    }

    await Notification.findByIdAndDelete(id);

    return res.json({
      success: true,
      message: "Уведомление успешно удалено",
    });
  } catch (err) {
    console.error("Ошибка при удалении уведомления:", err);
    res
      .status(500)
      .json({ success: false, message: "Ошибка при удалении уведомления" });
  }
};
