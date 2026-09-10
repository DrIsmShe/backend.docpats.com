import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import Article from "../../../common/models/Articles/articles.js";
import ArticleScientific from "../../../common/models/Articles/articles-scince.js";
import CommentDocpats from "../../../common/models/Comments/CommentDocpats.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import { tReq } from "../../../common/i18n/index.js";

const AllDoctorArticlesController = async (req, res) => {
  try {
    const profileId = req.params.id;
    console.log(`📌 Запрос на статьи доктора. ID профиля: ${profileId}`);

    if (!req.session.userId) {
      return res
        .status(401)
        .json({ success: false, message: tReq(req, "app.auth.notAuthorized2") });
    }

    if (!["doctor", "patient"].includes(req.session.role)) {
      return res
        .status(403)
        .json({ success: false, message: tReq(req, "app.access.forbidden") });
    }

    const doctorProfile = await DoctorProfile.findById(profileId).lean();
    if (!doctorProfile) {
      return res
        .status(404)
        .json({ success: false, message: tReq(req, "app.doctor.profileNotFound2") });
    }

    const user = await User.findById(doctorProfile.userId).lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: tReq(req, "app.doctor.notFound") });
    }

    const doctorInfo = {
      userId: user._id.toString(),
      firstName: user.firstNameEncrypted
        ? decrypt(user.firstNameEncrypted)
        : "Имя",
      lastName: user.lastNameEncrypted
        ? decrypt(user.lastNameEncrypted)
        : "Фамилия",
    };

    /* ОБЕ КОЛЛЕКЦИИ, а не одна.
       Мнения врача лежат в Article, научные статьи — в ArticleScine.
       Отдавалась только первая, и у врача с шестью научными работами и
       четырьмя мнениями страница показывала четыре.

       kind нужен странице, чтобы вести на нужный экран: у мнения и
       научной статьи разные адреса просмотра. targetType комментариев
       тоже разный — считаем каждый своим. */
    const [мнения, научные] = await Promise.all([
      Article.find({ authorId: doctorProfile.userId, isPublished: true })
        .lean()
        .sort({ createdAt: -1 }),
      ArticleScientific.find({
        authorId: doctorProfile.userId,
        isPublished: true,
      })
        .lean()
        .sort({ createdAt: -1 }),
    ]);

    const собрать = async (article, kind, targetType) => {
      const commentsCount = await CommentDocpats.countDocuments({
        targetId: article._id,
        targetType,
      });
      const likesCount = Array.isArray(article.likes) ? article.likes.length : 0;
      return { ...article, kind, commentsCount, likesCount };
    };

    const articlesWithCounts = (
      await Promise.all([
        ...мнения.map((a) => собрать(a, "opinion", "Article")),
        ...научные.map((a) => собрать(a, "scientific", "ArticleScine")),
      ])
    ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({
      success: true,
      doctorProfile: doctorInfo,
      articles: articlesWithCounts,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении статей доктора:", error);
    return res.status(500).json({ success: false, message: tReq(req, "app.server.error") });
  }
};

export default AllDoctorArticlesController;
