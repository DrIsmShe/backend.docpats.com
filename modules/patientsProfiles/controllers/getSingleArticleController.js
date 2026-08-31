import Article from "../../../common/models/Articles/articles.js";
import mongoose from "mongoose";

/**
 * Контроллер для получения одной статьи по ID
 * Доступ открыт для всех пользователей
 */
export const getSingleArticle = async (req, res) => {
  const { id: articleId } = req.params;

  // Проверяем корректность ID перед запросом в базу
  if (!mongoose.Types.ObjectId.isValid(articleId)) {
    console.warn(`⛔ Неверный формат ID статьи: ${articleId}`);
    return res.status(400).json({
      success: false,
      message: req.t("app.validation.invalidArticleIdFormat"),
    });
  }

  try {
    // Ищем статью по ID
    const article = await Article.findById(articleId);

    if (!article) {
      console.warn(`📭 Статья не найдена: ID = ${articleId}`);
      return res.status(404).json({
        success: false,
        message: req.t("app.article.notFound"),
      });
    }

    // Статья найдена — возвращаем её
    console.log(`✅ Статья найдена: ${article.title}`);
    return res.status(200).json({
      success: true,
      data: article,
    });
  } catch (error) {
    console.error("🔥 Ошибка сервера при получении статьи:", error.message);
    return res.status(500).json({
      success: false,
      message: req.t("app.article.fetchError"),
    });
  }
};
