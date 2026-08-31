import TempMRIResults from "../../../../common/models/Polyclinic/TempResults/tempMRIResults.js";
import { tReq } from "../../../../common/i18n/index.js";

const tempMRIResultsListGetController = async (req, res) => {
  try {
    const templates = await TempMRIResults.find();
    if (!templates) {
      return res
        .status(404)
        .json({ message: tReq(req, "myClinic.mriResultTemplate.notFound") });
    }
    res.status(200).json(templates);
  } catch (error) {
    console.error("Ошибка при получении шаблонов результатов МРТ:", error);
    res.status(500).json({ message: tReq(req, "myClinic.server.error2") });
  }
};

export default tempMRIResultsListGetController;
