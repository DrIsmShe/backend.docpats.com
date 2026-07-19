// server/modules/doctorsProfiles/controllers/doctorReview.controller.js
//
// Отзывы пациентов о враче: отправка (авторизованно, один на пару врач↔пациент)
// и публичное чтение (для профиля врача — доверие + SEO).

import mongoose from "mongoose";
import DoctorReview from "../../../common/models/DoctorProfile/doctorReview.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import Appointment from "../../../common/models/Appointment/appointment.js";
import { decrypt } from "../../../common/models/Auth/users.js";

const safeDecrypt = (v) => {
  if (!v) return null;
  try {
    return decrypt(v);
  } catch {
    return null;
  }
};

// Отображаемое имя автора: «Имя Ф.» (без раскрытия фамилии целиком).
function authorName(user) {
  const first = safeDecrypt(user?.firstNameEncrypted) || "";
  const last = safeDecrypt(user?.lastNameEncrypted) || "";
  const initial = last ? `${last[0]}.` : "";
  return `${first} ${initial}`.trim() || "Пациент";
}

// POST /doctor-profile/reviews/:doctorProfileId
export async function submitDoctorReview(req, res) {
  try {
    const patientId = req.userId; // authMiddleware
    const { doctorProfileId } = req.params;
    const { rating, text } = req.body || {};

    if (!patientId) {
      return res.status(401).json({ success: false, message: "Требуется авторизация." });
    }
    if (!mongoose.Types.ObjectId.isValid(doctorProfileId)) {
      return res.status(400).json({ success: false, message: "Некорректный ID врача." });
    }
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return res.status(400).json({ success: false, message: "Оценка должна быть от 1 до 5." });
    }
    if (text && String(text).length > 1000) {
      return res.status(400).json({ success: false, message: "Отзыв слишком длинный (макс. 1000)." });
    }

    const doctor = await DoctorProfile.findById(doctorProfileId).select("userId");
    if (!doctor) {
      return res.status(404).json({ success: false, message: "Врач не найден." });
    }
    // нельзя оставить отзыв самому себе
    if (doctor.userId && String(doctor.userId) === String(patientId)) {
      return res.status(400).json({ success: false, message: "Нельзя оценивать свой профиль." });
    }

    const review = await DoctorReview.findOneAndUpdate(
      { doctorProfileId, patientId },
      { rating: r, text: (text || "").trim(), status: "visible" },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return res.status(200).json({ success: true, review });
  } catch (err) {
    console.error("submitDoctorReview error:", err.message);
    return res.status(500).json({ success: false, message: "Ошибка сервера." });
  }
}

// GET /doctor-profile/reviews/:doctorProfileId  (публично)
export async function getDoctorReviews(req, res) {
  try {
    const { doctorProfileId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(doctorProfileId)) {
      return res.status(400).json({ success: false, message: "Некорректный ID врача." });
    }

    const docs = await DoctorReview.find({ doctorProfileId, status: "visible" })
      .populate("patientId", "firstNameEncrypted lastNameEncrypted avatar")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const reviews = docs.map((d) => ({
      _id: d._id,
      rating: d.rating,
      text: d.text || "",
      createdAt: d.createdAt,
      author: authorName(d.patientId),
      avatar: d.patientId?.avatar || null,
    }));

    const count = reviews.length;
    const average =
      count > 0
        ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10
        : 0;

    return res.status(200).json({ success: true, average, count, reviews });
  } catch (err) {
    console.error("getDoctorReviews error:", err.message);
    return res.status(500).json({ success: false, message: "Ошибка сервера." });
  }
}

// Бейджи-достижения врача, выведенные из агрегатов (без доп. запросов).
// Возвращаем { key, icon, label } — фронт может локализовать по key,
// с фолбэком на русский label.
export function computeDoctorBadges(s) {
  const badges = [];
  const appts = s.completedAppointments || 0;
  const reviews = s.reviewCount || 0;
  const rating = s.averageRating || 0;
  const patients = s.patientsServed || 0;
  const months = s.monthsOnPlatform || 0;

  // Приёмы — показываем самый высокий достигнутый порог.
  if (appts >= 500) badges.push({ key: "appts_500", icon: "🏅", label: "500+ приёмов" });
  else if (appts >= 100) badges.push({ key: "appts_100", icon: "🏅", label: "100+ приёмов" });
  else if (appts >= 50) badges.push({ key: "appts_50", icon: "🏅", label: "50+ приёмов" });

  // Рейтинг (при достаточном числе отзывов).
  if (reviews >= 10 && rating >= 4.8)
    badges.push({ key: "rating_excellent", icon: "⭐", label: "Отличный рейтинг" });
  else if (reviews >= 5 && rating >= 4.5)
    badges.push({ key: "rating_high", icon: "⭐", label: "Высокий рейтинг" });

  // Пациенты и признание.
  if (patients >= 100) badges.push({ key: "patients_100", icon: "👥", label: "100+ пациентов" });
  if (reviews >= 50) badges.push({ key: "reviews_50", icon: "💬", label: "Народный выбор" });

  // Стаж на платформе.
  if (months >= 12) badges.push({ key: "veteran", icon: "🚀", label: "Год+ на DocPats" });

  return badges;
}

// GET /doctor-profile/stats/:doctorProfileId  (публично)
// «Счётчик доверия» — только агрегаты, БЕЗ PHI: рейтинг, число отзывов,
// проведённых приёмов, уникальных пациентов, стаж на платформе, верификация.
export async function getDoctorTrustStats(req, res) {
  try {
    const { doctorProfileId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(doctorProfileId)) {
      return res
        .status(400)
        .json({ success: false, message: "Некорректный ID врача." });
    }

    const profile = await DoctorProfile.findById(doctorProfileId)
      .select("verificationStatus isVerified createdAt")
      .lean();
    if (!profile) {
      return res.status(404).json({ success: false, message: "Врач не найден." });
    }

    const oid = new mongoose.Types.ObjectId(doctorProfileId);

    // Отзывы: среднее + количество (одним запросом).
    const [reviewAgg, completedAppointments, distinctPatients] =
      await Promise.all([
        DoctorReview.aggregate([
          { $match: { doctorProfileId: oid, status: "visible" } },
          { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: "$rating" } } },
        ]),
        // doctorId в приёме ссылается на DoctorProfile напрямую.
        Appointment.countDocuments({ doctorId: oid, status: "completed" }),
        Appointment.distinct("patientId", { doctorId: oid, status: "completed" }),
      ]);

    const reviewCount = reviewAgg[0]?.count || 0;
    const averageRating = reviewAgg[0]?.avg
      ? Math.round(reviewAgg[0].avg * 10) / 10
      : 0;
    const patientsServed = distinctPatients.filter(Boolean).length;

    const memberSince = profile.createdAt || null;
    const monthsOnPlatform = memberSince
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(memberSince).getTime()) /
              (1000 * 60 * 60 * 24 * 30),
          ),
        )
      : 0;

    const stats = {
      averageRating,
      reviewCount,
      completedAppointments,
      patientsServed,
      memberSince,
      monthsOnPlatform,
      isVerified:
        profile.verificationStatus === "approved" ||
        profile.isVerified === true,
    };

    return res.status(200).json({
      success: true,
      ...stats,
      badges: computeDoctorBadges(stats),
    });
  } catch (err) {
    console.error("getDoctorTrustStats error:", err.message);
    return res.status(500).json({ success: false, message: "Ошибка сервера." });
  }
}
