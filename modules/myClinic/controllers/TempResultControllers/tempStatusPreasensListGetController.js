import TempStatusPreasens from "../../../../common/models/Polyclinic/TempResults/tempStatusPreasens.js";

const tempStatusPreasensListGetController = async (req, res) => {
  try {
    const templates = await TempStatusPreasens.find();
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

export default tempStatusPreasensListGetController;
