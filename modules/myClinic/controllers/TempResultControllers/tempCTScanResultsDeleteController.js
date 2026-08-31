import TempCTScanResults from "../../../../common/models/Polyclinic/TempResults/tempCTScanResults.js";

const tempCTScanResultsDeleteController = async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем, существует ли шаблон жалобы
    const template = await TempCTScanResults.findById(id);
    if (!template) {
      return res.status(404).json({ message: req.t("myClinic.template.notFound") });
    }

    // Удаляем шаблон
    await TempCTScanResults.findByIdAndDelete(id); // исправленный вызов

    return res.status(200).json({ message: req.t("myClinic.template.deletedSuccessfully") });
  } catch (error) {
    console.error("Ошибка при удалении шаблона :", error);
    return res.status(500).json({ message: req.t("myClinic.server.internalError") });
  }
};

export default tempCTScanResultsDeleteController;
