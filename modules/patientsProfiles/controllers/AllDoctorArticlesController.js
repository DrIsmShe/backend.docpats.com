import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import Article from "../../../common/models/Articles/articles.js";
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

    const articles = await Article.find({
      authorId: doctorProfile.userId,
      isPublished: true,
    })
      .lean()
      .sort({ createdAt: -1 });

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
        };
      })
    );

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
