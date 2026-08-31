import TempLaboratoryTestResults from "../../../../common/models/Polyclinic/TempResults/tempLaboratoryTestResults.js";
import mongoose from "mongoose";

const tempLaboratoryTestResultsDetailGetController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: req.t("myClinic.template.invalidId") });
    }
    const template = await TempLaboratoryTestResults.findById(id);
    if (!template) {
      return res
        .status(404)
        .json({ message: req.t("myClinic.anamnesisMorbi.templateNotFound") });
    }
    res.status(200).json(template);
  } catch (error) {
    console.error("Ошибка при получении шаблона анамнеза morbi:", error);
    res.status(500).json({ message: req.t("myClinic.server.error2") });
  }
};

export default tempLaboratoryTestResultsDetailGetController;
