import Article from "../../../../common/models/Articles/articles.js";
import User from "../../../../common/models/Auth/users.js";
import { tReq } from "../../../../common/i18n/index.js";

// === Лайк или дизлайк статьи ===
export const toggleArticleLike = async (req, res) => {
  try {
    const userId = req.user._id; // Из session или JWT
    const { articleId } = req.params;

    const article = await Article.findById(articleId);
    if (!article) return res.status(404).json({ message: tReq(req, "app.article.notFound") });

    const index = article.likes.indexOf(userId);

    if (index === -1) {
      article.likes.push(userId); // лайк
    } else {
      article.likes.splice(index, 1); // убрали лайк
    }

    await article.save();
    return res.json({ likesCount: article.likes.length, liked: index === -1 });
  } catch (err) {
    console.error("❌ Ошибка лайка статьи:", err.message);
    res.status(500).json({ message: tReq(req, "app.server.error") });
  }
};

// === Лайк или дизлайк профиля доктора ===
export const toggleDoctorLike = async (req, res) => {
  try {
    const userId = req.user._id;
    const { doctorId } = req.params;

    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== "doctor") {
      return res.status(404).json({ message: tReq(req, "app.doctor.notFound") });
    }

    if (!doctor.likes) doctor.likes = [];

    const index = doctor.likes.indexOf(userId);

    if (index === -1) {
      doctor.likes.push(userId);
    } else {
      doctor.likes.splice(index, 1);
    }

    await doctor.save();
    return res.json({ likesCount: doctor.likes.length, liked: index === -1 });
  } catch (err) {
    console.error("❌ Ошибка лайка доктора:", err.message);
    res.status(500).json({ message: tReq(req, "app.server.error") });
  }
};
export const getLikeStatus = async (req, res) => {
  try {
    const { targetType, targetId } = req.params;
    const userId = req.user._id;

    console.log("📩 Получен запрос на статус лайка:", { targetType, targetId });

    let doc;
    if (targetType === "article") {
      doc = await Article.findById(targetId);
    } else if (targetType === "doctor") {
      doc = await User.findById(targetId);
    }

    if (!doc) {
      console.warn("❌ Не найден объект для лайка:", targetType, targetId);
      return res.status(404).json({ message: tReq(req, "app.general.notFound") });
    }

    const likes = doc.likes || [];
    const liked = likes.includes(userId);
    return res.json({ likesCount: likes.length, liked });
  } catch (err) {
    console.error("❌ Ошибка получения статуса лайка:", err.message);
    res.status(500).json({ message: tReq(req, "app.server.error") });
  }
};
