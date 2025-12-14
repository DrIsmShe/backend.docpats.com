import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import Notification from "../../../common/models/Notification/notification.js";

const notificationForConfirmationController = async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(403).json({ message: "Необходимо войти в систему." });
    }

    const notifications = await Notification.find({
      targetUser: req.session.userId,
    }).sort({ createdAt: -1 });

    return res.status(200).json(notifications);
  } catch (error) {
    console.error("Ошибка при получении уведомлений:", error);
    return res.status(500).json({ message: "Ошибка сервера." });
  }
};

export default notificationForConfirmationController;
