import TempRecommendations from "../../../../common/models/Polyclinic/TempResults/tempRecommendations.js";

const tempRecommendationsListGetController = async (req, res) => {
  try {
    const templates = await TempRecommendations.find();
    if (!templates) {
      return res
        .status(404)
        .json({ message: "Шаблоны анамнеза morbi не найдены" });
    }
    res.status(200).json(templates);
  } catch (error) {
    console.error("Ошибка при получении шаблонов анамнеза morbi:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

export default tempRecommendationsListGetController;
