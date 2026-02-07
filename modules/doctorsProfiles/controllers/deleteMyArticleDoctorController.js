import Article from "../../../common/models/Articles/articles.js"; // Предположим, что у вас есть модель статьи.

const deleteMyArticleDoctorController = async (req, res) => {
  const { id } = req.params; // Получаем ID статьи из параметров URL
  const { userId } = req.session; // Получаем ID пользователя из сессии
  const articleSingle = await Article.findById(id); // Используем findById для поиска статьи по ID
  if (articleSingle.authorId != userId) {
    return res
      .status(404)
      .json({ message: "You do not have permission to delete this article" });
  }
  try {
    // Find an article by ID and delete it
    const article = await Article.findByIdAndDelete(id);

    if (!article) {
      return res.status(404).json({ message: "Article not found" });
    }

    // Response with successful deletion
    res.status(200).json({ message: "Article successfully deleted" });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "An error occurred while deleting the article" });
  }
};

export default deleteMyArticleDoctorController;
