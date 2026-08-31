import TempAnamnesisVitae from "../../../../common/models/Polyclinic/TempResults/tempAnamnesisVitae.js";

const TempAnamnesisVitaeDeleteController = async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, существует ли шаблон жалобы
    const template = await TempAnamnesisVitae.findById(id);
    if (!template) {
      return res.status(404).json({ message: req.t("myClinic.template.notFound") });
    }

    // Удаляем шаблон
    await TempAnamnesisVitae.findByIdAndDelete(id); // исправленный вызов

    return res.status(200).json({ message: req.t("myClinic.template.deletedSuccessfully") });
  } catch (error) {
    console.error("Ошибка при удалении шаблона :", error);
    return res.status(500).json({ message: req.t("myClinic.server.internalError") });
  }
};

export default TempAnamnesisVitaeDeleteController;
