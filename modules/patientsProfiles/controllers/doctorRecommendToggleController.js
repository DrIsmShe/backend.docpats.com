import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import User from "../../../common/models/Auth/users.js";

/**
 * POST /patient-profile/doctor/:id/recommend
 * Body: { action?: "add" | "remove" }  // опционально; если не задано — toggle
 * Только для роли "patient".
 */
const doctorRecommendToggleController = async (req, res) => {
  try {
    const { id } = req.params; // profileId
    const sessionUserId = req.session.userId;

    if (!id)
      return res.status(400).json({ ok: false, message: "Нет id профиля" });
    if (!sessionUserId)
      return res.status(403).json({ ok: false, message: "Нет авторизации" });

    const me = await User.findById(sessionUserId).lean();
    if (!me || me.role !== "patient")
      return res
        .status(403)
        .json({ ok: false, message: "Только пациенты могут рекомендовать" });

    const profile = await DoctorProfile.findById(id)
      .select("recommendations userId")
      .lean();
    if (!profile)
      return res.status(404).json({ ok: false, message: "Профиль не найден" });

    // Не даем рекомендовать самого себя, если пациент = врач (на всякий случай)
    if (String(profile.userId) === String(sessionUserId)) {
      return res
        .status(400)
        .json({ ok: false, message: "Нельзя рекомендовать себя" });
    }

    const already = await DoctorProfile.exists({
      _id: id,
      recommendations: sessionUserId,
    });

    let op = null;
    const action =
      typeof req.body?.action === "string" ? req.body.action : null;

    if (action === "add") op = already ? null : "$addToSet";
    else if (action === "remove") op = already ? "$pull" : null;
    else op = already ? "$pull" : "$addToSet"; // toggle

    if (!op) {
      // Ничего менять не надо — просто вернем текущее состояние
      const count = Array.isArray(profile.recommendations)
        ? profile.recommendations.length
        : 0;
      return res.status(200).json({
        ok: true,
        recommended: already ? true : false,
        recommendCount: count,
      });
    }

    const update =
      op === "$addToSet"
        ? { $addToSet: { recommendations: sessionUserId } }
        : { $pull: { recommendations: sessionUserId } };

    const updated = await DoctorProfile.findByIdAndUpdate(id, update, {
      new: true,
      select: "recommendations",
    }).lean();

    const recommendCount = Array.isArray(updated?.recommendations)
      ? updated.recommendations.length
      : 0;

    return res.status(200).json({
      ok: true,
      recommended: op === "$addToSet",
      recommendCount,
    });
  } catch (e) {
    console.error("❌ Recommend toggle error:", e);
    return res.status(500).json({ ok: false, message: "Ошибка сервера" });
  }
};

export default doctorRecommendToggleController;
