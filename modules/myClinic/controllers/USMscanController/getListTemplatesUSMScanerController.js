import USMScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateNameofexam.js";
import USMScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateReport.js";
import USMScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateDiagnosis.js";
import USMScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateRecomandation.js";

// Получить список шаблонов отчёта (Report)
const getListNameofexamTemplatesUSMscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await USMScanerTemplateNameofexam.find({
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
const getListReportTemplatesUSMscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await USMScanerTemplateReport.find({ doctor: doctorId })
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
const getListDiagnosisTemplatesUSMscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await USMScanerTemplateDiagnosis.find({
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
const getListRecomandationTemplatesUSMscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await USMScanerTemplateRecomandation.find({
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
  getListNameofexamTemplatesUSMscanerController,
  getListReportTemplatesUSMscanerController,
  getListDiagnosisTemplatesUSMscanerController,
  getListRecomandationTemplatesUSMscanerController,
};
