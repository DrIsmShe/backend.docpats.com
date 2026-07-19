// server/modules/notifications/controllers/preferences.controller.js
//
// Настройки уведомлений пользователя (пока — опт-аут email-дайджеста).
// Пуш-канал управляется отдельно через /notifications/push/*.

import User from "../../../common/models/Auth/users.js";

// GET /notifications/preferences  (auth)
export async function getNotificationPreferences(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });
    }
    const u = await User.findById(userId).select("emailDigestEnabled").lean();
    if (!u) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.status(200).json({
      success: true,
      emailDigestEnabled: u.emailDigestEnabled !== false,
    });
  } catch (err) {
    console.error("getNotificationPreferences error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// PATCH /notifications/preferences  (auth)
export async function updateNotificationPreferences(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });
    }
    const update = {};
    if (typeof req.body?.emailDigestEnabled === "boolean") {
      update.emailDigestEnabled = req.body.emailDigestEnabled;
    }
    if (!Object.keys(update).length) {
      return res
        .status(400)
        .json({ success: false, message: "No valid preferences" });
    }
    await User.updateOne({ _id: userId }, { $set: update });
    return res.status(200).json({ success: true, ...update });
  } catch (err) {
    console.error("updateNotificationPreferences error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
