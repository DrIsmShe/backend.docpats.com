import EKGScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateNameofexam.js";
import EKGScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateReport.js";
import EKGScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateDiagnosis.js";
import EKGScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateRecomandation.js";
import { tReq } from "../../../../common/i18n/index.js";

// Получить список шаблонов отчёта (Report)
const getListNameofexamTemplatesEKGscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await EKGScanerTemplateNameofexam.find({
      doctor: doctorId,
    })
      .populate("doctor", "firstName lastName")
      .sort({ createdAt: -1 });
    res.status(200).json(templates);
  } catch (error) {
    res
      .status(500)
      .json({ message: tReq(req, "myClinic.reportTemplate.fetchError"), error });
  }
};

// Получить список шаблонов отчёта (Report)
const getListReportTemplatesEKGscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await EKGScanerTemplateReport.find({
      doctor: doctorId,
    })
      .populate("doctor", "firstName lastName")
      .sort({ createdAt: -1 });
    res.status(200).json(templates);
  } catch (error) {
    res
      .status(500)
      .json({ message: tReq(req, "myClinic.reportTemplate.fetchError"), error });
  }
};

// Получить список шаблонов диагноза (Diagnosis)
const getListDiagnosisTemplatesEKGscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await EKGScanerTemplateDiagnosis.find({
      doctor: doctorId,
    })
      .populate("doctor", "firstName lastName")
      .sort({ createdAt: -1 });
    res.status(200).json(templates);
  } catch (error) {
    res
      .status(500)
      .json({ message: tReq(req, "myClinic.diagnosisTemplate.fetchError"), error });
  }
};

// Получить список шаблонов рекомендаций (Recomandation)
const getListRecomandationTemplatesEKGscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await EKGScanerTemplateRecomandation.find({
      doctor: doctorId,
    })
      .populate("doctor", "firstName lastName")
      .sort({ createdAt: -1 });
    res.status(200).json(templates);
  } catch (error) {
    res
      .status(500)
      .json({ message: tReq(req, "myClinic.recommendationTemplate.fetchError"), error });
  }
};

export default {
  getListNameofexamTemplatesEKGscanerController,
  getListReportTemplatesEKGscanerController,
  getListDiagnosisTemplatesEKGscanerController,
  getListRecomandationTemplatesEKGscanerController,
};
