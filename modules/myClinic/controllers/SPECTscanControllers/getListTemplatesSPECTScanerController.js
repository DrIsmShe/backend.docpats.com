import SPECTScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScanTemplateNameofexam.js";
import SPECTScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScanTemplateReport.js";
import SPECTScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTSchemaTemplateDiagnosis.js";
import SPECTScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScanTemplateRecomandation.js";

// Получить список шаблонов отчёта (Report)
const getListNameofexamTemplatesSPECTScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await SPECTScanTemplateNameofexam.find({
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
const getListReportTemplatesSPECTScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await SPECTScanTemplateReport.find({ doctor: doctorId })
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
const getListDiagnosisTemplatesSPECTScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await SPECTScanTemplateDiagnosis.find({
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
const getListRecomandationTemplatesSPECTScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await SPECTScanTemplateRecomandation.find({
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
  getListNameofexamTemplatesSPECTScanerController,
  getListReportTemplatesSPECTScanerController,
  getListDiagnosisTemplatesSPECTScanerController,
  getListRecomandationTemplatesSPECTScanerController,
};
