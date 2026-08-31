import AngiographyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateNameofexam.js";
import AngiographyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateReport.js";
import AngiographycanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateDiagnosis.js";
import AngiographyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateRecomandation.js";
import { tReq } from "../../../../common/i18n/index.js";
import { errorText } from "../../../../common/i18n/index.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesAngiographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await AngiographyScanerTemplateNameofexam.findByIdAndUpdate(
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
      error: errorText(error, req),
    });
  }
};

// Обновление шаблона отчёта
const updateReportTemplatesAngiographyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await AngiographyScanerTemplateReport.findByIdAndUpdate(
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
      error: errorText(error, req),
    });
  }
};

// Обновление шаблона диагноза
const updateDiagnosisTemplatesAngiographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await AngiographycanerTemplateDiagnosis.findByIdAndUpdate(
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
      error: errorText(error, req),
    });
  }
};

// Обновление шаблона рекомендации
const updateRecomandationTemplatesAngiographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated =
      await AngiographyScanerTemplateRecomandation.findByIdAndUpdate(
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
      error: errorText(error, req),
    });
  }
};

export default {
  updateNameofexamTemplatesAngiographyScanerController,
  updateReportTemplatesAngiographyScanerController,
  updateDiagnosisTemplatesAngiographyScanerController,
  updateRecomandationTemplatesAngiographyScanerController,
};
