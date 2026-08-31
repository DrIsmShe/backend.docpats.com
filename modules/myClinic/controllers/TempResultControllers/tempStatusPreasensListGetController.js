import TempStatusPreasens from "../../../../common/models/Polyclinic/TempResults/tempStatusPreasens.js";
import { tReq } from "../../../../common/i18n/index.js";

const tempStatusPreasensListGetController = async (req, res) => {
  try {
    const templates = await TempStatusPreasens.find();
    if (!templates) {
      return res
        .status(404)
        .json({ message: tReq(req, "myClinic.anamnesisMorbi.templatesNotFound") });
    }
    res.status(200).json(templates);
  } catch (error) {
    console.error("Ошибка при получении шаблонов анамнеза morbi:", error);
    res.status(500).json({ message: tReq(req, "myClinic.server.error2") });
  }
};

export default tempStatusPreasensListGetController;
