import TempMRIResults from "../../../../common/models/Polyclinic/TempResults/tempMRIResults.js";
import { tReq } from "../../../../common/i18n/index.js";

const TempMRResultsDeleteController = async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, существует ли шаблон жалобы
    const template = await TempMRIResults.findById(id);
    if (!template) {
      return res.status(404).json({ message: tReq(req, "myClinic.template.notFound") });
    }

    // Удаляем шаблон
    await TempMRIResults.findByIdAndDelete(id); // исправленный вызов

    return res.status(200).json({ message: tReq(req, "myClinic.template.deletedSuccessfully") });
  } catch (error) {
    console.error("Ошибка при удалении шаблона :", error);
    return res.status(500).json({ message: tReq(req, "myClinic.server.internalError") });
  }
};

export default TempMRResultsDeleteController;
