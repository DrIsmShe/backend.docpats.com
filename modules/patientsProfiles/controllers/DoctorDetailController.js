import DoctorProfile from "../../models/profileDoctor.js";
import User from "../../models/users.js";
import Article from "../../models/articles.js";
import { tReq } from "../../../common/i18n/index.js";

const DoctorDetailController = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.userId; // Берем userId только из сессии

    console.log("📌 Запрос профиля доктора:");
    console.log("🔍 doctorId:", id);
    console.log("🔍 userId из сессии:", userId);

    if (!id) {
      console.error("❌ Ошибка: ID доктора не указан");
      return res.status(400).json({ error: tReq(req, "app.doctor.idNotSpecified") });
    }

    if (!userId) {
      console.error("❌ Ошибка: userId отсутствует в сессии");
      return res
        .status(403)
        .json({ error: tReq(req, "app.access.deniedNoUserId") });
    }

    // Получаем профиль доктора
    const doctor = await DoctorProfile.findById(id).lean();
    if (!doctor) {
      console.error("❌ Ошибка: Доктор не найден");
      return res.status(404).json({ error: tReq(req, "app.doctor.notFound") });
    }

    // Получаем данные пользователя, связанного с доктором
    const user = await User.findById(doctor.userId).lean();

    // Проверяем, является ли текущий пользователь пациентом или доктором
    const requestingUser = await User.findById(userId).lean();
    if (
      !requestingUser ||
      (requestingUser.role !== "doctor" && requestingUser.role !== "patient")
    ) {
      console.error(
        "❌ Ошибка: Недостаточно прав (роль:",
        requestingUser?.role || "неизвестно",
        ")"
      );
      return res
        .status(403)
        .json({ error: tReq(req, "app.access.deniedInsufficientPermissions") });
    }

    // Получаем статьи, написанные доктором
    const articles = await Article.find({ authorId: doctor.userId }).lean();

    // Формируем данные для ответа
    const doctorDetails = {
      ...doctor,
      user,
      articles,
    };

    console.log("✅ Успешно отправлен профиль доктора");
    return res.status(200).json(doctorDetails);
  } catch (error) {
    console.error("❌ Ошибка при получении данных доктора:", error);
    return res.status(500).json({ error: tReq(req, "app.server.internalError") });
  }
};

export default DoctorDetailController;
