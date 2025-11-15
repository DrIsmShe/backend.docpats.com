import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import Article from "../../../common/models/Articles/articles.js";
import CommentDocpats from "../../../common/models/Comments/CommentDocpats.js";
import User from "../../../common/models/Auth/users.js"; // Нужно для данных автора

const AllDoctorArticlesController = async (req, res) => {
  try {
    const doctorId = req.params.id;
    console.log(`📌 Запрос на статьи доктора ID: ${doctorId}`);

    // Проверка авторизации
    if (!req.session.userId) {
      console.warn("⚠️ Неавторизованный запрос");
      return res
        .status(401)
        .json({ success: false, message: "Не авторизован" });
    }

    if (!["doctor", "patient"].includes(req.session.role)) {
      console.warn(`⚠️ Доступ запрещен! Роль: ${req.session.role}`);
      return res
        .status(403)
        .json({ success: false, message: "Доступ запрещен" });
    }

    // Поиск профиля доктора
    const doctorProfile = await DoctorProfile.findById(doctorId).lean();
    if (!doctorProfile) {
      console.warn(`❌ Доктор с ID ${doctorId} не найден`);
      return res
        .status(404)
        .json({ success: false, message: "Доктор не найден" });
    }

    console.log(`✅ Доктор найден`);

    // Получаем данные пользователя (автора)
    const user = await User.findById(doctorProfile.userId);
    const decryptedUser = user
      ? user.decryptFields()
      : { firstName: "Неизвестно", lastName: "" };

    // Поиск статей
    const articles = await Article.find({
      authorId: doctorProfile.userId,
      isPublished: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    console.log(`✅ Найдено ${articles.length} статей`);

    // Добавляем количество комментариев, лайков и автора к каждой статье
    const articlesWithCounts = await Promise.all(
      articles.map(async (article) => {
        const commentsCount = await CommentDocpats.countDocuments({
          targetId: article._id,
          targetType: "Article",
        });

        const likesCount = Array.isArray(article.likes)
          ? article.likes.length
          : 0;

        return {
          ...article,
          commentsCount,
          likesCount,
          author: {
            firstName: decryptedUser.firstName,
            lastName: decryptedUser.lastName,
          },
        };
      })
    );

    return res.status(200).json({
      success: true,
      doctor: {
        firstName: decryptedUser.firstName,
        lastName: decryptedUser.lastName,
      },
      data: articlesWithCounts,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении статей:", error);
    return res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
};

export default AllDoctorArticlesController;
