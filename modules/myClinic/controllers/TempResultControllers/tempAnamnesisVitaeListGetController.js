import TempAnamnesisVitae from "../../../../common/models/Polyclinic/TempResults/tempAnamnesisVitae.js";

const tempAnamnesisVitaeListGetController = async (req, res) => {
  try {
    const templates = await TempAnamnesisVitae.find();
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

export default tempAnamnesisVitaeListGetController;
