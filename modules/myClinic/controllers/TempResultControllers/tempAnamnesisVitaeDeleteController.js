import TempAnamnesisVitae from "../../../../common/models/Polyclinic/TempResults/tempAnamnesisVitae.js";

const TempAnamnesisVitaeDeleteController = async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, существует ли шаблон жалобы
    const template = await TempAnamnesisVitae.findById(id);
    if (!template) {
      return res.status(404).json({ message: "Шаблон  не найден" });
    }

    // Удаляем шаблон
    await TempAnamnesisVitae.findByIdAndDelete(id); // исправленный вызов

    return res.status(200).json({ message: "Шаблон  успешно удален" });
  } catch (error) {
    console.error("Ошибка при удалении шаблона :", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
};

export default TempAnamnesisVitaeDeleteController;
