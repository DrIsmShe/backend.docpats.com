import CTScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateNameofexam.js";

import CTScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateReport.js";
import CTScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateDiagnosis.js";
import CTScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateRecomandation.js";
import { tReq } from "../../../../common/i18n/index.js";

// Получить список шаблонов отчёта (Report)
const getListNameofexamTemplatesCTScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await CTScanTemplateNameofexam.find({ doctor: doctorId })
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
const getListReportTemplatesCTScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await CTScanTemplateReport.find({ doctor: doctorId })
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
const getListDiagnosisTemplatesCTScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await CTScanTemplateDiagnosis.find({ doctor: doctorId })
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
const getListRecomandationTemplatesCTScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await CTScanTemplateRecomandation.find({
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
  getListNameofexamTemplatesCTScanerController,
  getListReportTemplatesCTScanerController,
  getListDiagnosisTemplatesCTScanerController,
  getListRecomandationTemplatesCTScanerController,
};
