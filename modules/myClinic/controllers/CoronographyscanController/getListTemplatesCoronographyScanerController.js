import CoronographyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateNameofexam.js";
import CoronographyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateReport.js";
import CoronographyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateDiagnosis.js";
import CoronographyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateRecomandation.js";

// Получить список шаблонов отчёта (Report)
const getListNameofexamTemplatesCoronographyscanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await CoronographyScanerTemplateNameofexam.find({
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
const getListReportTemplatesCoronographyscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await CoronographyScanerTemplateReport.find({
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
const getListDiagnosisTemplatesCoronographyscanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await CoronographyScanerTemplateDiagnosis.find({
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
const getListRecomandationTemplatesCoronographyscanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await CoronographyScanerTemplateRecomandation.find({
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
  getListNameofexamTemplatesCoronographyscanerController,
  getListReportTemplatesCoronographyscanerController,
  getListDiagnosisTemplatesCoronographyscanerController,
  getListRecomandationTemplatesCoronographyscanerController,
};
