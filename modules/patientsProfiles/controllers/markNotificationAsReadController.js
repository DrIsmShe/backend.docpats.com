import Notification from "../../../common/models/Notification/notification.js";

const markNotificationAsReadController = async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(403).json({ message: "Необходимо войти в систему." });
    }

    const { id } = req.params;
    const notification = await Notification.findOne({
      _id: id,
      targetUser: req.session.userId,
    });

    if (!notification) {
      return res.status(404).json({ message: "Уведомление не найдено." });
    }

    await Notification.deleteOne({ _id: id });

    console.log(`✅ Уведомление ${id} помечено как прочитанное`);
    return res
      .status(200)
      .json({ message: "Уведомление помечено как прочитанное" });
  } catch (error) {
    console.error("❌ Ошибка при обновлении уведомления:", error);
    return res
      .status(500)
      .json({ message: "Ошибка при обновлении уведомления." });
  }
};

export default markNotificationAsReadController;
