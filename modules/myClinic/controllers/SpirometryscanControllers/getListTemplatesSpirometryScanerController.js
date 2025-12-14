import SpirometryScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateNameofexam.js";
import SpirometryScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateReport.js";
import SpirometryScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateDiagnosis.js";
import SpirometryScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateRecomandation.js";

// Получить список шаблонов отчёта (Report)
const getListNameofexamTemplatesSpirometryScanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await SpirometryScanTemplateNameofexam.find({
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
const getListReportTemplatesSpirometryScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await SpirometryScanTemplateReport.find({
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
const getListDiagnosisTemplatesSpirometryScanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await SpirometryScanTemplateDiagnosis.find({
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
const getListRecomandationTemplatesSpirometryScanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await SpirometryScanTemplateRecomandation.find({
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
  getListNameofexamTemplatesSpirometryScanerController,
  getListReportTemplatesSpirometryScanerController,
  getListDiagnosisTemplatesSpirometryScanerController,
  getListRecomandationTemplatesSpirometryScanerController,
};
