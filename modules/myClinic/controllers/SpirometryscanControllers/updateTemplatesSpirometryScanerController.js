import SpirometryScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateNameofexam.js";
import SpirometryScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateReport.js";
import SpirometryScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateDiagnosis.js";
import SpirometryScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateRecomandation.js";
import { tReq } from "../../../../common/i18n/index.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesSpirometryScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await SpirometryScanTemplateNameofexam.findByIdAndUpdate(
      id,
      { title, content },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: tReq(req, "myClinic.reportTemplate.notFound") });
    }

    res
      .status(200)
      .json({ message: tReq(req, "myClinic.reportTemplate.updateSuccess"), updated });
  } catch (error) {
    res.status(500).json({
      message: tReq(req, "myClinic.reportTemplate.updateError"),
      error: error.message,
    });
  }
};

// Обновление шаблона отчёта
const updateReportTemplatesSpirometryScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await SpirometryScanTemplateReport.findByIdAndUpdate(
      id,
      { title, content },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: tReq(req, "myClinic.reportTemplate.notFound") });
    }

    res
      .status(200)
      .json({ message: tReq(req, "myClinic.reportTemplate.updateSuccess"), updated });
  } catch (error) {
    res.status(500).json({
      message: tReq(req, "myClinic.reportTemplate.updateError"),
      error: error.message,
    });
  }
};

// Обновление шаблона диагноза
const updateDiagnosisTemplatesSpirometryScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await SpirometryScanTemplateDiagnosis.findByIdAndUpdate(
      id,
      { title, content },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: tReq(req, "myClinic.diagnosisTemplate.notFound") });
    }

    res
      .status(200)
      .json({ message: tReq(req, "myClinic.diagnosisTemplate.updateSuccess"), updated });
  } catch (error) {
    res.status(500).json({
      message: tReq(req, "myClinic.diagnosisTemplate.updateError"),
      error: error.message,
    });
  }
};

// Обновление шаблона рекомендации
const updateRecomandationTemplatesSpirometryScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await SpirometryScanTemplateRecomandation.findByIdAndUpdate(
      id,
      { title, content },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: tReq(req, "myClinic.recommendationTemplate.notFound") });
    }

    res
      .status(200)
      .json({ message: tReq(req, "myClinic.recommendationTemplate.updateSuccess"), updated });
  } catch (error) {
    res.status(500).json({
      message: tReq(req, "myClinic.recommendationTemplate.updateError"),
      error: error.message,
    });
  }
};

export default {
  updateNameofexamTemplatesSpirometryScanerController,
  updateReportTemplatesSpirometryScanerController,
  updateDiagnosisTemplatesSpirometryScanerController,
  updateRecomandationTemplatesSpirometryScanerController,
};
