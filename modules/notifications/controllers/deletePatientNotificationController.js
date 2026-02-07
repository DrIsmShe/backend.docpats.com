import Notification from "../../../common/models/Notification/notification.js";

export const deletePatientNotificationController = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const result = await Notification.deleteOne({
      _id: id,
      recipientId: userId,
    });
    if (result.deletedCount === 0)
      return res.status(404).json({ success: false, message: "Не найдено" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};
