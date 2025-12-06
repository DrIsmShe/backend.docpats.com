import Article from "../../../common/models/Articles/articles.js";

const countAllArticlesController = async (req, res) => {
  try {
    const totalArticles = await Article.countDocuments(); // Подсчет всех статей в базе

    res.status(200).json({ count: totalArticles });
  } catch (error) {
    console.error("Error counting all articles:", error);
    res.status(500).json({ message: "Server error counting articles" });
  }
};

export default countAllArticlesController;
