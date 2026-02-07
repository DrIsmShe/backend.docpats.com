import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import Article from "../../../common/models/Articles/articles.js";

const DoctorDetailsForPatientController = async (req, res) => {
  try {
    const { id } = req.params; // профайл врача
    const sessionUserId = req.session.userId;

    if (!id) return res.status(400).json({ error: "Не передан ID доктора" });
    if (!sessionUserId)
      return res
        .status(403)
        .json({ error: "Доступ запрещен: нет авторизации" });

    const doctorProfile = await DoctorProfile.findById(id).lean();
    if (!doctorProfile)
      return res.status(404).json({ error: "Профиль доктора не найден" });

    const doctorUser = await User.findById(doctorProfile.userId)
      .populate({ path: "specialization", select: "name" })
      .lean();
    if (!doctorUser) return res.status(404).json({ error: "Доктор не найден" });

    // Кто запрашивает — пускаем пациентов и врачей (как раньше)
    const requestingUser = await User.findById(sessionUserId).lean();
    if (!requestingUser || !["patient", "doctor"].includes(requestingUser.role))
      return res
        .status(403)
        .json({ error: "Доступ запрещен: недостаточно прав" });

    // Статьи доктора
    const doctorArticles = await Article.find({
      authorId: doctorUser._id,
    }).lean();

    // Рекомендации
    const recArr = Array.isArray(doctorProfile.recommendations)
      ? doctorProfile.recommendations
      : [];
    const recommendedByMe = recArr.some(
      (uid) => String(uid) === String(sessionUserId)
    );
    const recommendCount = recArr.length;

    const doctorDetails = {
      userId: String(doctorUser._id),
      profileId: String(doctorProfile._id),
      firstName: doctorUser.firstNameEncrypted
        ? decrypt(doctorUser.firstNameEncrypted)
        : "Имя не указано",
      lastName: doctorUser.lastNameEncrypted
        ? decrypt(doctorUser.lastNameEncrypted)
        : "Фамилия не указана",
      profileImage:
        doctorProfile.profileImage ||
        "http://localhost:11000/uploads/default.png",
      specialization: doctorUser.specialization
        ? doctorUser.specialization.name
        : "Не указано",
      about: doctorProfile.about || "Информация отсутствует",
      country: doctorProfile.country || "Не указано",
      clinic: doctorProfile.clinic || "Не указано",
      // НОВОЕ:
      recommendedByMe,
      recommendCount,
      // Было:
      articles: doctorArticles || [],
    };

    return res.status(200).json(doctorDetails);
  } catch (error) {
    console.error("❌ Ошибка профиля врача:", error);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
};

export default DoctorDetailsForPatientController;
