import PETScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateNameofexam.js";
import PETScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateReport.js";
import PETScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateDiagnosis.js";
import PETScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateRecomandation.js";

// Получить список шаблонов отчёта (Report)
const getListNameofexamTemplatesPETScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await PETScanTemplateNameofexam.find({
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
const getListReportTemplatesPETScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await PETScanTemplateReport.find({ doctor: doctorId })
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
const getListDiagnosisTemplatesPETScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await PETScanTemplateDiagnosis.find({ doctor: doctorId })
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
const getListRecomandationTemplatesPETScanerController = async (req, res) => {
  // Здесь предполагается, что ID врача хранится в req.user._id после аутентификации
  const doctorId = req.session.userId;
  try {
    const templates = await PETScanTemplateRecomandation.find({
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
  getListNameofexamTemplatesPETScanerController,
  getListReportTemplatesPETScanerController,
  getListDiagnosisTemplatesPETScanerController,
  getListRecomandationTemplatesPETScanerController,
};
