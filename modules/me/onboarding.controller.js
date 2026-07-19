// server/modules/me/onboarding.controller.js
//
// Онбординг: чек-лист заполнения профиля. Шаги вычисляются из реальных данных
// (аватар, специализация, верификация, расписание, статьи, рефералы). Фронт
// переводит заголовки по ключу шага; бэкенд отдаёт key/done/link.

import User from "../../common/models/Auth/users.js";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import Article from "../../common/models/Articles/articles.js";
import DoctorSchedule from "../../common/models/Appointment/doctorSchedule.js";
import { ConsultationSession } from "../consultation/consultation.model.js";

// Дефолтные аватары считаем «не загружено».
function hasCustomAvatar(avatar) {
  if (!avatar) return false;
  const a = String(avatar).toLowerCase();
  return !a.includes("/avatars/boy0") && !a.includes("default");
}

export async function getOnboarding(req, res) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });
    }

    const user = await User.findById(userId)
      .select("role avatar specialization referralCount myDoctors")
      .lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const avatarOk = hasCustomAvatar(user.avatar);
    let steps = [];

    if (user.role === "doctor") {
      const [profile, articleCount, schedule] = await Promise.all([
        DoctorProfile.findOne({ userId }).select("verificationStatus").lean(),
        Article.countDocuments({ authorId: userId }),
        DoctorSchedule.findOne({ doctorId: userId }).select("_id").lean(),
      ]);
      steps = [
        { key: "avatar", done: avatarOk, link: "/doctor/home-page" },
        { key: "specialization", done: !!user.specialization, link: "/doctor/home-page" },
        {
          key: "verification",
          done: profile?.verificationStatus === "approved",
          link: "/doctor/verification",
        },
        { key: "schedule", done: !!schedule, link: "/doctor/doctor-schedule" },
        { key: "article", done: articleCount > 0, link: "/doctor/create-my-articles" },
        {
          key: "invite",
          done: (user.referralCount || 0) > 0,
          link: "/doctor/invite",
        },
      ];
    } else {
      // Пациент / прочие
      const consult = await ConsultationSession.findOne({ userId })
        .select("consultationsUsed")
        .lean();
      steps = [
        { key: "avatar", done: avatarOk, link: "/patient/home-page" },
        {
          key: "consultation",
          done: (consult?.consultationsUsed || 0) > 0,
          link: "/patient/consultation-ai",
        },
        {
          key: "doctor",
          done: Array.isArray(user.myDoctors) && user.myDoctors.length > 0,
          link: "/patient/doctors",
        },
        {
          key: "invite",
          done: (user.referralCount || 0) > 0,
          link: "/patient/invite",
        },
      ];
    }

    const completed = steps.filter((s) => s.done).length;
    return res.status(200).json({
      success: true,
      role: user.role,
      completed,
      total: steps.length,
      steps,
    });
  } catch (err) {
    console.error("getOnboarding error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
