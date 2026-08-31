import TempCTScanResults from "../../../../common/models/Polyclinic/TempResults/tempCTScanResults.js";
import mongoose from "mongoose";
import { tReq } from "../../../../common/i18n/index.js";

const TempCTScanResultsDetailGetController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: tReq(req, "myClinic.template.invalidId") });
    }
    const template = await TempCTScanResults.findById(id);
    if (!template) {
      return res.status(404).json({ message: tReq(req, "myClinic.template.notFound") });
    }
    res.status(200).json(template);
  } catch (error) {
    console.error("Ошибка при получении шаблона:", error);
    res.status(500).json({ message: tReq(req, "myClinic.server.error2") });
  }
};

export default TempCTScanResultsDetailGetController;
