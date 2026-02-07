import TempAdditionalDiagnosis from "../../../../common/models/Polyclinic/TempResults/tempAdditionalDiagnosis.js";

const tempAdditionalDiagnosisDeleteController = async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, существует ли шаблон жалобы
    const template = await TempAdditionalDiagnosis.findById(id);
    if (!template) {
      return res.status(404).json({ message: "Шаблон  не найден" });
    }

    // Удаляем шаблон
    await TempAdditionalDiagnosis.findByIdAndDelete(id); // исправленный вызов

    return res.status(200).json({ message: "Шаблон  успешно удален" });
  } catch (error) {
    console.error("Ошибка при удалении шаблона :", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
};

export default tempAdditionalDiagnosisDeleteController;
