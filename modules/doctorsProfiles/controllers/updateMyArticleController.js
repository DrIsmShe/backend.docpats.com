import Article from "../../../common/models/Articles/articles.js"; // Подключаем модель статьи

const updateMyArticleController = async (req, res) => {
  const { id } = req.params; // Получаем ID статьи из параметров маршрута
  const {
    title,
    content,
    tags,
    metaDescription,
    metaKeywords,
    isPublished,
    category,
  } = req.body; // Деструктурируем данные из тела запроса

  // Проверяем, было ли загружено новое изображение
  const imageUrl = req.file
    ? `http://localhost:11000/uploads/${req.file.filename}`
    : undefined;

  try {
    // Формируем объект для обновления
    const updateFields = {
      title,
      content,
      tags,
      metaDescription,
      metaKeywords,
      isPublished,
      category,
      updatedAt: Date.now(), // Обновляем поле updatedAt
    };

    // Добавляем URL изображения, если оно было загружено
    if (imageUrl) {
      updateFields.imageUrl = imageUrl;
    }

    // Поиск статьи по ID и обновление данных
    const updatedArticle = await Article.findByIdAndUpdate(
      id,
      updateFields,
      { new: true, runValidators: true } // Возвращаем обновленную статью и проверяем валидность данных
    );

    if (!updatedArticle) {
      return res.status(404).json({ message: "Article not found." });
    }

    res.status(200).json({
      message: "Article updated successfully.",
      article: updatedArticle,
    });
  } catch (error) {
    console.error("Error updating article:", error);
    res
      .status(500)
      .json({ message: "An error occurred updating the article." });
  }
};

export default updateMyArticleController;
