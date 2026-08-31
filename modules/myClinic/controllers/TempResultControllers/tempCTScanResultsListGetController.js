import tempCTScanResults from "../../../../common/models/Polyclinic/TempResults/tempCTScanResults.js";

const tempCTScanResultsListGetController = async (req, res) => {
  try {
    const templates = await tempCTScanResults.find();
    if (!templates) {
      return res
        .status(404)
        .json({ message: req.t("myClinic.anamnesisMorbi.templatesNotFound") });
    }
    res.status(200).json(templates);
  } catch (error) {
    console.error("Ошибка при получении шаблонов анамнеза morbi:", error);
    res.status(500).json({ message: req.t("myClinic.server.error2") });
  }
};

export default tempCTScanResultsListGetController;
