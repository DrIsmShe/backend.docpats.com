import XRAYScanTemplateNameofexams from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateNameofexams.js";
import XRAYScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateReports.js";
import XRAYScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateDiagnos.js";
import XRAYScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateRecomandations.js";

// Получить список шаблонов отчёта (Report)
const getListNameofexamTemplatesXRAYScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await XRAYScanTemplateNameofexams.find({
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
const getListReportTemplatesXRAYScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await XRAYScanTemplateReport.find({ doctor: doctorId })
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
const getListDiagnosisTemplatesXRAYScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await XRAYScanTemplateDiagnosis.find({ doctor: doctorId })
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
const getListRecomandationTemplatesXRAYScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await XRAYScanTemplateRecomandation.find({
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
  getListNameofexamTemplatesXRAYScanerController,
  getListReportTemplatesXRAYScanerController,
  getListDiagnosisTemplatesXRAYScanerController,
  getListRecomandationTemplatesXRAYScanerController,
};
