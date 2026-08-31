import GastroscopyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateNameofexam.js";
import GastroscopyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateReport.js";
import GastroscopyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateDiagnosis.js";
import GastroscopyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateRecomandation.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesGastroscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await GastroscopyScanerTemplateNameofexam.findByIdAndUpdate(
      id,
      { title, content },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: req.t("myClinic.reportTemplate.notFound") });
    }

    res
      .status(200)
      .json({ message: req.t("myClinic.reportTemplate.updateSuccess"), updated });
  } catch (error) {
    res.status(500).json({
      message: req.t("myClinic.reportTemplate.updateError"),
      error: error.message,
    });
  }
};

// Обновление шаблона отчёта
const updateReportTemplatesGastroscopyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await GastroscopyScanerTemplateReport.findByIdAndUpdate(
      id,
      { title, content },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: req.t("myClinic.reportTemplate.notFound") });
    }

    res
      .status(200)
      .json({ message: req.t("myClinic.reportTemplate.updateSuccess"), updated });
  } catch (error) {
    res.status(500).json({
      message: req.t("myClinic.reportTemplate.updateError"),
      error: error.message,
    });
  }
};

// Обновление шаблона диагноза
const updateDiagnosisTemplatesGastroscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await GastroscopyScanerTemplateDiagnosis.findByIdAndUpdate(
      id,
      { title, content },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: req.t("myClinic.diagnosisTemplate.notFound") });
    }

    res
      .status(200)
      .json({ message: req.t("myClinic.diagnosisTemplate.updateSuccess"), updated });
  } catch (error) {
    res.status(500).json({
      message: req.t("myClinic.diagnosisTemplate.updateError"),
      error: error.message,
    });
  }
};

// Обновление шаблона рекомендации
const updateRecomandationTemplatesGastroscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated =
      await GastroscopyScanerTemplateRecomandation.findByIdAndUpdate(
        id,
        { title, content },
        { new: true, runValidators: true }
      );

    if (!updated) {
      return res.status(404).json({ message: req.t("myClinic.recommendationTemplate.notFound") });
    }

    res
      .status(200)
      .json({ message: req.t("myClinic.recommendationTemplate.updateSuccess"), updated });
  } catch (error) {
    res.status(500).json({
      message: req.t("myClinic.recommendationTemplate.updateError"),
      error: error.message,
    });
  }
};

export default {
  updateNameofexamTemplatesGastroscopyScanerController,
  updateReportTemplatesGastroscopyScanerController,
  updateDiagnosisTemplatesGastroscopyScanerController,
  updateRecomandationTemplatesGastroscopyScanerController,
};
