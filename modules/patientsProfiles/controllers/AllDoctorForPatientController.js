// ✅ controllers/patient/AllDoctorController.js
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import Article from "../../../common/models/Articles/articles.js";
import Specialization from "../../../common/models/DoctorProfile/specialityOfDoctor.js";
import Comments from "../../../common/models/Comments/CommentDocpats.js";
import DoctorSchedule from "../../../common/models/Appointment/doctorSchedule.js";

/**
 * Получение списка всех врачей с фильтрацией и проверкой даты
 */
const AllDoctorController = async (req, res) => {
  try {
    const { country, specialty, minRating, minReviews, date, sort } = req.query;
    console.log("📥 Получены фильтры:", req.query);

    const baseFilter = {};
    if (country) baseFilter.country = new RegExp(country.trim(), "i");

    const doctors = await DoctorProfile.find(baseFilter).lean();
    if (!doctors.length) {
      return res.status(200).json({
        success: true,
        total: 0,
        filters: { countries: [], specialties: [] },
        data: [],
      });
    }

    const allCountries = new Set();
    const allSpecialties = new Set();
    const validDoctors = [];

    // helper для даты без TZ
    const normalizeDate = (d) => {
      const local = new Date(d);
      const y = local.getFullYear();
      const m = String(local.getMonth() + 1).padStart(2, "0");
      const day = String(local.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`; // формат "2025-10-24"
    };

    for (const doctor of doctors) {
      const user = await User.findById(doctor.userId).lean();
      if (!user || user.role !== "doctor") continue;

      const firstName = user.firstNameEncrypted
        ? decrypt(user.firstNameEncrypted)
        : "Имя не указано";
      const lastName = user.lastNameEncrypted
        ? decrypt(user.lastNameEncrypted)
        : "Фамилия не указана";

      let specialtyName = "Не указана";
      if (user.specialization) {
        const spec = await Specialization.findById(user.specialization).lean();
        if (spec?.name) specialtyName = spec.name;
      }

      allCountries.add(doctor.country || "Не указана");
      allSpecialties.add(specialtyName);

      // === фильтры по стране и специализации ===
      if (
        specialty &&
        !specialtyName.toLowerCase().includes(specialty.toLowerCase())
      )
        continue;
      if (
        doctor.country &&
        country &&
        doctor.country.toLowerCase() !== country.toLowerCase()
      )
        continue;

      // === фильтр по дате ===
      if (date) {
        const preferredDate = normalizeDate(date);
        const dayOfWeek = new Date(date).getDay(); // 0 = вс

        const schedule = await DoctorSchedule.findOne({
          doctorId: doctor.userId,
        }).lean();

        let hasSlot = false;
        if (schedule) {
          const workingDays = schedule.workingDays || [];
          const workingIntervals = schedule.workingIntervals || [];
          const exceptions = schedule.exceptions || [];

          const isWorkingDay = workingDays.includes(dayOfWeek);
          const hasIntervals = workingIntervals.length > 0;

          const dayException = exceptions.find(
            (ex) => normalizeDate(ex.date) === preferredDate
          );
          const isDayOff = dayException?.isDayOff === true;

          hasSlot = isWorkingDay && hasIntervals && !isDayOff;
        }

        console.log(
          `📅 Проверка: врач ${
            doctor.userId
          } → ${preferredDate} [день ${dayOfWeek}] => ${
            hasSlot ? "✅ есть слоты" : "❌ нет"
          }`
        );

        if (!hasSlot) continue;
      }

      // === рейтинг, отзывы ===
      const authoredArticles = await Article.find(
        { authorId: doctor.userId, isPublished: true },
        { _id: 1, likes: 1 }
      ).lean();

      const articleIds = authoredArticles.map((a) => a._id);
      const totalLikes = authoredArticles.reduce(
        (acc, a) => acc + (Array.isArray(a.likes) ? a.likes.length : 0),
        0
      );
      const totalComments = articleIds.length
        ? await Comments.countDocuments({
            targetType: "Article",
            targetId: { $in: articleIds },
            isDeleted: false,
          })
        : 0;
      const profileReviewsCount = await Comments.countDocuments({
        targetType: "Doctor",
        targetId: doctor._id,
        isDeleted: false,
      });

      const fakeRating = 3.5 + Math.min(profileReviewsCount / 20, 1.5);
      if (minRating && fakeRating < Number(minRating)) continue;
      if (minReviews && profileReviewsCount < Number(minReviews)) continue;

      const consultationPrice =
        doctor.consultationPrice || Math.round(50 + Math.random() * 100);

      validDoctors.push({
        profileId: doctor._id.toString(),
        userId: doctor.userId.toString(),
        profileImage: doctor.profileImage || "/uploads/default.png",
        about: doctor.about || "Нет описания",
        country: doctor.country || "Не указана",
        clinic: doctor.clinic || doctor.company || "Не указана",
        createdAt: doctor.createdAt || new Date(),
        firstName,
        lastName,
        specialty: specialtyName,
        reviewsCount: profileReviewsCount,
        rating: Number(fakeRating.toFixed(1)),
        consultationPrice,
        articles: {
          count: articleIds.length,
          comments: totalComments,
          likes: totalLikes,
        },
      });
    }

    // === сортировка ===
    if (sort) {
      const sortMap = {
        priceAsc: (a, b) => a.consultationPrice - b.consultationPrice,
        priceDesc: (a, b) => b.consultationPrice - a.consultationPrice,
        ratingDesc: (a, b) => b.rating - a.rating,
        reviewsDesc: (a, b) => b.reviewsCount - a.reviewsCount,
      };
      validDoctors.sort(sortMap[sort]);
    }

    return res.status(200).json({
      success: true,
      total: validDoctors.length,
      filters: {
        countries: [...allCountries],
        specialties: [...allSpecialties],
      },
      data: validDoctors,
    });
  } catch (err) {
    console.error("❌ Ошибка AllDoctorController:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export default AllDoctorController;
