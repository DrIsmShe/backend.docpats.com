import MRIScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateNameofexam.js";
import MRIScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateReport.js";
import MRIScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateDiagnosis.js";
import MRIScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateRecomandation.js";

// Получить список шаблонов отчёта (Report)
const getListNameofexamTemplatesMRIscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await MRIScanerTemplateNameofexam.find({
      doctor: doctorId,
    })
      .populate("doctor", "firstName lastName")
      .sort({ createdAt: -1 });
    res.status(200).json(templates);
  } catch (error) {
    res
      .status(500)
      .json({ message: req.t("myClinic.reportTemplate.fetchError"), error });
  }
};

// Получить список шаблонов отчёта (Report)
const getListReportTemplatesMRIscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await MRIScanerTemplateReport.find({ doctor: doctorId })
      .populate("doctor", "firstName lastName")
      .sort({ createdAt: -1 });
    res.status(200).json(templates);
  } catch (error) {
    res
      .status(500)
      .json({ message: req.t("myClinic.reportTemplate.fetchError"), error });
  }
};

// Получить список шаблонов диагноза (Diagnosis)
const getListDiagnosisTemplatesMRIscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await MRIScanerTemplateDiagnosis.find({
      doctor: doctorId,
    })
      .populate("doctor", "firstName lastName")
      .sort({ createdAt: -1 });
    res.status(200).json(templates);
  } catch (error) {
    res
      .status(500)
      .json({ message: req.t("myClinic.diagnosisTemplate.fetchError"), error });
  }
};

// Получить список шаблонов рекомендаций (Recomandation)
const getListRecomandationTemplatesMRIscanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await MRIScanerTemplateRecomandation.find({
      doctor: doctorId,
    })
      .populate("doctor", "firstName lastName")
      .sort({ createdAt: -1 });
    res.status(200).json(templates);
  } catch (error) {
    res
      .status(500)
      .json({ message: req.t("myClinic.recommendationTemplate.fetchError"), error });
  }
};

export default {
  getListNameofexamTemplatesMRIscanerController,
  getListReportTemplatesMRIscanerController,
  getListDiagnosisTemplatesMRIscanerController,
  getListRecomandationTemplatesMRIscanerController,
};
