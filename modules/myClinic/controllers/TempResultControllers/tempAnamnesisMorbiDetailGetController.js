import TempAnamnesisMorbi from "../../../../common/models/Polyclinic/TempResults/tempAnamnesisMorbi.js";
import mongoose from "mongoose";

const tempAnamnesisMorbiDetailGetController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Неверный ID шаблона" });
    }
    const template = await TempAnamnesisMorbi.findById(id);
    if (!template) {
      return res
        .status(404)
        .json({ message: "Шаблон анамнеза morbi не найден" });
    }
    res.status(200).json(template);
  } catch (error) {
    console.error("Ошибка при получении шаблона анамнеза morbi:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

export default tempAnamnesisMorbiDetailGetController;
