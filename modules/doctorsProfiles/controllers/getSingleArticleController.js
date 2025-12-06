import mongoose from "mongoose";
import Article from "../../../common/models/Articles/articles.js";
import User from "../../../common/models/Auth/users.js";

/**
 * GET /admin/article/:id
 * Доступ:
 *   - админ (всегда)
 *   - автор статьи (если реализована проверка)
 *   - публичный просмотр (если опубликована)
 */
export const getSingleArticle = async (req, res) => {
  const { id: articleId } = req.params;
  const userRole = req.user?.role || null; // из middleware auth/session
  const userId = req.user?._id?.toString() || null;

  // Проверка ID
  if (!mongoose.Types.ObjectId.isValid(articleId)) {
    return res
      .status(400)
      .json({ success: false, message: "Неверный формат ID статьи" });
  }

  try {
    // Загружаем статью
    const articleDoc = await Article.findById(articleId)
      .populate({
        path: "authorId",
        model: User,
        select:
          "username role avatar firstNameEncrypted lastNameEncrypted firstName lastName",
      })
      .exec();

    if (!articleDoc) {
      return res
        .status(404)
        .json({ success: false, message: "Статья не найдена" });
    }

    // Проверка прав: админ — всегда может; автор — только свою; иначе — если опубликована
    if (
      userRole !== "admin" &&
      !articleDoc.isPublished &&
      articleDoc.authorId?._id?.toString() !== userId
    ) {
      return res.status(403).json({
        success: false,
        message: "У вас нет доступа к этой статье",
      });
    }

    // Преобразуем статью в объект (с виртуалами)
    const article = articleDoc.toObject({ virtuals: true });

    // Чистим зашифрованные поля
    if (article.authorId) {
      delete article.authorId.firstNameEncrypted;
      delete article.authorId.lastNameEncrypted;
    }

    // Создаем автора (раскодированный)
    let authorDecryptedManual = null;
    let authorPublic = null;

    if (
      articleDoc.authorId &&
      typeof articleDoc.authorId.decryptFields === "function"
    ) {
      const dec = articleDoc.authorId.decryptFields(); // { firstName, lastName, email }
      authorDecryptedManual = dec;
      authorPublic = {
        _id: articleDoc.authorId._id,
        username: articleDoc.authorId.username,
        role: articleDoc.authorId.role,
        avatar: articleDoc.authorId.avatar,
        firstName: dec.firstName ?? article.authorId?.firstName ?? null,
        lastName: dec.lastName ?? article.authorId?.lastName ?? null,
      };
    } else if (article.authorId) {
      authorPublic = {
        _id: article.authorId._id,
        username: article.authorId.username,
        role: article.authorId.role,
        avatar: article.authorId.avatar,
        firstName: article.authorId.firstName ?? null,
        lastName: article.authorId.lastName ?? null,
      };
    }

    // Возврат данных
    return res.status(200).json({
      success: true,
      data: {
        ...article,
        authorPublic,
        authorDecryptedManual,
        accessibleBy: userRole || "guest",
      },
    });
  } catch (error) {
    console.error("🔥 Ошибка при получении статьи:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении статьи",
    });
  }
};
