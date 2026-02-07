import HOLTERScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateNameofexam.js";
import HOLTERScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateReport.js";
import HOLTERScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateDiagnosis.js";
import HOLTERScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateRecomandation.js";

// Получить список шаблонов отчёта (Report)
const getListNameofexamTemplatesHOLTERscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await HOLTERScanerTemplateNameofexam.find({
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

// Получить список шаблонов отчёта (Report)
const getListReportTemplatesHOLTERscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await HOLTERScanerTemplateReport.find({
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

// Получить список шаблонов диагноза (Diagnosis)
const getListDiagnosisTemplatesHOLTERscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await HOLTERScanerTemplateDiagnosis.find({
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

// Получить список шаблонов рекомендаций (Recomandation)
const getListRecomandationTemplatesHOLTERscanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await HOLTERScanerTemplateRecomandation.find({
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
  getListNameofexamTemplatesHOLTERscanerController,
  getListReportTemplatesHOLTERscanerController,
  getListDiagnosisTemplatesHOLTERscanerController,
  getListRecomandationTemplatesHOLTERscanerController,
};
