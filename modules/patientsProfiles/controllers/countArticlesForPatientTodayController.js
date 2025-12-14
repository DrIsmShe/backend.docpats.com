import Article from "../../../common/models/Articles/articles.js";

const countArticlesTodayController = async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0); // Устанавливаем начало дня
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999); // Устанавливаем конец дня

    const count = await Article.countDocuments({
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    });

    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Ошибка при подсчете статей" });
  }
};

export default countArticlesTodayController;
