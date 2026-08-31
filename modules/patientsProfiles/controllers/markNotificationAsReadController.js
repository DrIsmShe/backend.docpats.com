import Notification from "../../../common/models/Notification/notification.js";
import { tReq } from "../../../common/i18n/index.js";

const markNotificationAsReadController = async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(403).json({ message: tReq(req, "app.auth.loginRequired") });
    }

    const { id } = req.params;
    const notification = await Notification.findOne({
      _id: id,
      targetUser: req.session.userId,
    });

    if (!notification) {
      return res.status(404).json({ message: tReq(req, "app.notification.notFound") });
    }

    await Notification.deleteOne({ _id: id });

    console.log(`✅ Уведомление ${id} помечено как прочитанное`);
    return res
      .status(200)
      .json({ message: tReq(req, "app.notification.markedAsRead") });
  } catch (error) {
    console.error("❌ Ошибка при обновлении уведомления:", error);
    return res
      .status(500)
      .json({ message: tReq(req, "app.notification.updateError") });
  }
};

export default markNotificationAsReadController;
