// server/modules/doctorsProfiles/controllers/publicTopDoctors.controller.js
//
// Публичный (без авторизации) список врачей, отсортированный по реальному
// рейтингу — основа SEO-страниц «Лучшие {специальность}». Батч-запросы,
// без N+1. Только агрегаты/публичные поля, без PHI кроме имени (публичного).

import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import Specialization from "../../../common/models/DoctorProfile/specialityOfDoctor.js";
import DoctorReview from "../../../common/models/DoctorProfile/doctorReview.js";

const safe = (v) => {
  if (!v) return "";
  try {
    return decrypt(v) || "";
  } catch {
    return "";
  }
};

// GET /api/v1/public/top-doctors?specialty=&country=&limit=
export async function getPublicTopDoctors(req, res) {
  try {
    const { specialty, country } = req.query;
    const limit = Math.min(Number(req.query.limit) || 30, 60);

    const baseFilter = {};
    if (country) baseFilter.country = new RegExp(String(country).trim(), "i");

    const profiles = await DoctorProfile.find(baseFilter)
      .select("userId country profileImage")
      .lean();
    if (!profiles.length) {
      return res.status(200).json({ success: true, total: 0, doctors: [] });
    }

    const userIds = profiles.map((p) => p.userId).filter(Boolean);
    const users = await User.find({ _id: { $in: userIds }, role: "doctor" })
      .select("firstNameEncrypted lastNameEncrypted specialization role")
      .lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const specIds = users.map((u) => u.specialization).filter(Boolean);
    const specs = specIds.length
      ? await Specialization.find({ _id: { $in: specIds } })
          .select("name")
          .lean()
      : [];
    const specMap = new Map(specs.map((s) => [String(s._id), s.name]));

    // Рейтинги — один агрегат.
    const profileIds = profiles.map((p) => p._id);
    const ratingAgg = await DoctorReview.aggregate([
      { $match: { doctorProfileId: { $in: profileIds }, status: "visible" } },
      {
        $group: {
          _id: "$doctorProfileId",
          count: { $sum: 1 },
          avg: { $avg: "$rating" },
        },
      },
    ]);
    const ratingMap = new Map(
      ratingAgg.map((r) => [
        String(r._id),
        { count: r.count, avg: Math.round(r.avg * 10) / 10 },
      ]),
    );

    const specNeedle = specialty ? String(specialty).toLowerCase() : null;
    const doctors = [];

    for (const p of profiles) {
      const user = userMap.get(String(p.userId));
      if (!user) continue; // не врач / нет юзера

      const specName = user.specialization
        ? specMap.get(String(user.specialization)) || ""
        : "";
      if (specNeedle && !specName.toLowerCase().includes(specNeedle)) continue;

      const rt = ratingMap.get(String(p._id)) || { count: 0, avg: 0 };
      const name =
        `${safe(user.firstNameEncrypted)} ${safe(user.lastNameEncrypted)}`.trim() ||
        "Врач";

      doctors.push({
        profileId: String(p._id),
        name,
        specialty: specName || null,
        country: p.country || null,
        profileImage: p.profileImage || null,
        rating: rt.avg,
        reviewCount: rt.count,
        url: `/public/doctor-profile/doctor-details/${p._id}`,
      });
    }

    // Сначала лучшие: по рейтингу, тай-брейк по числу отзывов.
    doctors.sort(
      (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount,
    );

    return res.status(200).json({
      success: true,
      total: doctors.length,
      doctors: doctors.slice(0, limit),
    });
  } catch (err) {
    console.error("getPublicTopDoctors error:", err.message);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}
