import TempStatusPreasens from "../../../../common/models/Polyclinic/TempResults/tempStatusPreasens.js"; // Импортируем модель TempMRIResults

const TempStatusPreasensDeleteController = async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, существует ли шаблон жалобы
    const template = await TempStatusPreasens.findById(id);
    if (!template) {
      return res.status(404).json({ message: req.t("myClinic.template.notFound") });
    }

    // Удаляем шаблон
    await TempStatusPreasens.findByIdAndDelete(id); // исправленный вызов

    return res.status(200).json({ message: req.t("myClinic.template.deletedSuccessfully") });
  } catch (error) {
    console.error("Ошибка при удалении шаблона :", error);
    return res.status(500).json({ message: req.t("myClinic.server.internalError") });
  }
};

export default TempStatusPreasensDeleteController;
