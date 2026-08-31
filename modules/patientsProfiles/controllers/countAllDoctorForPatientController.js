import Article from "../../../common/models/Articles/articles.js";
import { tReq } from "../../../common/i18n/index.js";

const countAllArticlesController = async (req, res) => {
  try {
    const totalArticles = await Article.countDocuments(); // Подсчет всех статей в базе

    res.status(200).json({ count: totalArticles });
  } catch (error) {
    console.error("Ошибка при подсчете всех статей:", error);
    res.status(500).json({ message: tReq(req, "app.articles.countError") });
  }
};

export default countAllArticlesController;
