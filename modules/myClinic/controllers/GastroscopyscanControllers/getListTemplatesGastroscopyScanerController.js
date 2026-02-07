import GastroscopyScanTemplateReports from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateReport.js";
import GastroscopyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateDiagnosis.js";
import GastroscopyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateRecomandation.js";
import GastroscopyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateNameofexam.js";

// Получить список шаблонов отчёта (Report)
const getListReportTemplatesGastroscopyscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await GastroscopyScanTemplateReports.find({
      doctor: doctorId,
    })
      .populate("doctor", "firstName lastName")
      .sort({ createdAt: -1 });
    console.log(
      "REPORT COLLECTION:",
      GastroscopyScanTemplateReports.collection.name
    );

    res.status(200).json(templates);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Ошибка при получении шаблонов отчёта", error });
  }
};

// Получить список шаблонов диагноза (Diagnosis)
const getListDiagnosisTemplatesGastroscopyscanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await GastroscopyScanerTemplateDiagnosis.find({
      doctor: doctorId,
    })
      .populate("doctor", "firstName lastName")
      .sort({ createdAt: -1 });
    res.status(200).json(templates);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Ошибка при получении шаблонов диагноза", error });
  }
};
// Получить список шаблонов отчёта (Report)
const getListNameofexamTemplatesGastroscopyscanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await GastroscopyScanerTemplateNameofexam.find({
      doctor: doctorId,
    })
      .populate("doctor", "firstName lastName")
      .sort({ createdAt: -1 });
    res.status(200).json(templates);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Ошибка при получении шаблонов отчёта", error });
  }
};
// Получить список шаблонов рекомендаций (Recomandation)
const getListRecomandationTemplatesGastroscopyscanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await GastroscopyScanerTemplateRecomandation.find({
      doctor: doctorId,
    })
      .populate("doctor", "firstName lastName")
      .sort({ createdAt: -1 });
    res.status(200).json(templates);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Ошибка при получении шаблонов рекомендаций", error });
  }
};

export default {
  getListNameofexamTemplatesGastroscopyscanerController,
  getListReportTemplatesGastroscopyscanerController,
  getListDiagnosisTemplatesGastroscopyscanerController,
  getListRecomandationTemplatesGastroscopyscanerController,
};
