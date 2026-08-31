import { tReq } from "../../../../common/i18n/index.js";
import TempStatusLocalis from "../../../../common/models/Polyclinic/TempResults/tempStatusLocalis.js"; // Импортируем модель TempMRIResults

const TempStatusLocalisDeleteController = async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, существует ли шаблон жалобы
    const template = await TempStatusLocalis.findById(id);
    if (!template) {
      return res.status(404).json({ message: tReq(req, "myClinic.template.notFound") });
    }

    // Удаляем шаблон
    await TempStatusLocalis.findByIdAndDelete(id); // исправленный вызов

    return res.status(200).json({ message: tReq(req, "myClinic.template.deletedSuccessfully") });
  } catch (error) {
    console.error("Ошибка при удалении шаблона :", error);
    return res.status(500).json({ message: tReq(req, "myClinic.server.internalError") });
  }
};

export default TempStatusLocalisDeleteController;
