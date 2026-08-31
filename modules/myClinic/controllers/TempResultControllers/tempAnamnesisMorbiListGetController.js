import TempAnamnesisMorbi from "../../../../common/models/Polyclinic/TempResults/tempAnamnesisMorbi.js";

const tempAnamnesisMorbiListGetController = async (req, res) => {
  try {
    const templates = await TempAnamnesisMorbi.find();
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

export default tempAnamnesisMorbiListGetController;
