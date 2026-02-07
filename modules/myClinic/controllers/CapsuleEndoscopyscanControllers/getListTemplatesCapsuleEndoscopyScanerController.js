import CapsuleEndoscopyScannerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScanTemplateNameofexam.js";
import CapsuleEndoscopyScannerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScanTemplateReport.js";
import CapsuleEndoscopyScannerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScanTemplateDiagnosis.js";
import CapsuleEndoscopyScannerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScanTemplateRecomandation.js";

// Получить список шаблонов отчёта (Report)
const getListNameofexamTemplatesCapsuleEndoscopyscanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await CapsuleEndoscopyScannerTemplateNameofexam.find({
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
const getListReportTemplatesCapsuleEndoscopyscanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await CapsuleEndoscopyScannerTemplateReport.find({
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
const getListDiagnosisTemplatesCapsuleEndoscopyscanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await CapsuleEndoscopyScannerTemplateDiagnosis.find({
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
const getListRecomandationTemplatesCapsuleEndoscopyscanerController = async (
  req,
  res
) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await CapsuleEndoscopyScannerTemplateRecomandation.find({
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
  getListNameofexamTemplatesCapsuleEndoscopyscanerController,
  getListReportTemplatesCapsuleEndoscopyscanerController,
  getListDiagnosisTemplatesCapsuleEndoscopyscanerController,
  getListRecomandationTemplatesCapsuleEndoscopyscanerController,
};
