import GinecologyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateNameofexam.js";
import GinecologyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateReport.js";
import GinecologyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyTemplatesDiagnosis.js";
import GinecologyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateRecomandation.js";
import { tReq } from "../../../../common/i18n/index.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesGinecologyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await GinecologyScanerTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesGinecologyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await GinecologyScanerTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesGinecologyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await GinecologyScanerTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesGinecologyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated =
      await GinecologyScanerTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesGinecologyScanerController,
  updateReportTemplatesGinecologyScanerController,
  updateDiagnosisTemplatesGinecologyScanerController,
  updateRecomandationTemplatesGinecologyScanerController,
};
