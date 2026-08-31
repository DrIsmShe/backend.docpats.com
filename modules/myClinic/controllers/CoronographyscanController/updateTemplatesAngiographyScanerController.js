import CoronographyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateNameofexam.js";
import CoronographyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateReport.js";
import CoronographyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateDiagnosis.js";
import CoronographyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateRecomandation.js";
import { tReq } from "../../../../common/i18n/index.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesCoronographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated =
      await CoronographyScanerTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesCoronographyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await CoronographyScanerTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesCoronographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await CoronographyScanerTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesCoronographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated =
      await CoronographyScanerTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesCoronographyScanerController,
  updateReportTemplatesCoronographyScanerController,
  updateDiagnosisTemplatesCoronographyScanerController,
  updateRecomandationTemplatesCoronographyScanerController,
};
