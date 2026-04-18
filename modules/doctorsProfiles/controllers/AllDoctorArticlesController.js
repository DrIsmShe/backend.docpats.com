import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import Article from "../../../common/models/Articles/articles.js";
import ArticleScientific from "../../../common/models/Articles/articles-scince.js";
import CommentDocpats from "../../../common/models/Comments/CommentDocpats.js";
import User from "../../../common/models/Auth/users.js";

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

    // Поиск обычных и научных статей параллельно
    const [articles, scientificArticles] = await Promise.all([
      Article.find({ authorId: doctorProfile.userId, isPublished: true })
        .sort({ createdAt: -1 })
        .lean(),
      ArticleScientific.find({
        authorId: doctorProfile.userId,
        isPublished: true,
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    console.log(`✅ Найдено ${articles.length} обычных статей`);
    console.log(`✅ Найдено ${scientificArticles.length} научных статей`);

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
          articleType: "article",
          commentsCount,
          likesCount,
          author: {
            firstName: decryptedUser.firstName,
            lastName: decryptedUser.lastName,
          },
        };
      }),
    );

    // Добавляем количество комментариев, лайков и автора к каждой научной статье
    const scientificWithCounts = await Promise.all(
      scientificArticles.map(async (article) => {
        const commentsCount = await CommentDocpats.countDocuments({
          targetId: article._id,
          targetType: "ArticleScine",
        });

        const likesCount = Array.isArray(article.likes)
          ? article.likes.length
          : 0;

        return {
          ...article,
          articleType: "scientific",
          commentsCount,
          likesCount,
          author: {
            firstName: decryptedUser.firstName,
            lastName: decryptedUser.lastName,
          },
        };
      }),
    );

    // Объединяем и сортируем по дате
    const allArticles = [...articlesWithCounts, ...scientificWithCounts].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );

    return res.status(200).json({
      success: true,
      doctor: {
        firstName: decryptedUser.firstName,
        lastName: decryptedUser.lastName,
      },
      data: allArticles,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении статей:", error);
    return res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
};

export default AllDoctorArticlesController;
