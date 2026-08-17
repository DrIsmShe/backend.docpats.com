// server/modules/doctorsProfiles/controllers/competence.controller.js
//
// Учебная активность врача: публичный просмотр и собственная настройка.

import {
  getCompetence,
  setCompetenceVisibility,
} from "../services/competence.service.js";

/** GET /api/v1/public/doctors/:id/competence — то, что видит пациент. */
export async function getPublicCompetence(req, res) {
  try {
    const data = await getCompetence(req.params.id);
    // null — врач не включил показ, активности нет или это не врач.
    // Отвечаем 200 с null, а не 404: отсутствие блока не ошибка, и
    // страница профиля не должна из-за него падать.
    return res.json({ success: true, competence: data });
  } catch (err) {
    console.error("competence:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/** GET /api/me/competence — свои цифры, независимо от настройки показа. */
export async function getMyCompetence(req, res) {
  try {
    const data = await getCompetence(req.session.userId, { forSelf: true });
    return res.json({ success: true, competence: data });
  } catch (err) {
    console.error("competence:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/** PUT /api/me/competence — врач включает или выключает показ. */
export async function updateMyCompetence(req, res) {
  try {
    const out = await setCompetenceVisibility(
      req.session.userId,
      req.body?.enabled === true,
    );
    return res.json({ success: true, ...out });
  } catch (err) {
    console.error("competence:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

export default { getPublicCompetence, getMyCompetence, updateMyCompetence };
