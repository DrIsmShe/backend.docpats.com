// server/modules/notifications/controllers/preferences.controller.js
//
// Настройки уведомлений пользователя (пока — опт-аут email-дайджеста).
// Пуш-канал управляется отдельно через /notifications/push/*.

import User from "../../../common/models/Auth/users.js";
import {
  CONFERENCE_CATEGORIES,
  normalizeConferenceCategories,
} from "../../../common/config/conferenceCategories.js";

// GET /notifications/preferences  (auth)
export async function getNotificationPreferences(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });
    }
    const u = await User.findById(userId)
      .select("role emailDigestEnabled conferenceDigestEnabled conferenceCategories")
      .lean();
    if (!u) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.status(200).json({
      success: true,
      emailDigestEnabled: u.emailDigestEnabled !== false,
      conferenceDigestEnabled: u.conferenceDigestEnabled !== false,
      // Пустой массив — это «все категории», а не «ни одной». Фронт должен
      // рисовать его как все галочки, иначе врач решит, что подписка пуста.
      conferenceCategories: u.conferenceCategories || [],
      availableConferenceCategories: CONFERENCE_CATEGORIES,
      // Подборку конференций рассылает jobs/conferenceDigest.job.js, и она
      // адресована врачам. Пациенту переключатель показывать нельзя: это
      // обещание письма, которое никогда не придёт.
      conferenceDigestAvailable: u.role === "doctor",
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
    if (typeof req.body?.conferenceDigestEnabled === "boolean") {
      update.conferenceDigestEnabled = req.body.conferenceDigestEnabled;
    }
    if (Array.isArray(req.body?.conferenceCategories)) {
      // Незнакомые коды молча отбрасываем: список категорий живёт в двух
      // репозиториях, и рассинхрон не должен ронять сохранение настроек.
      update.conferenceCategories = normalizeConferenceCategories(
        req.body.conferenceCategories,
      );
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
