import PETScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateNameofexam.js";
import PETScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateReport.js";
import PETScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateDiagnosis.js";
import PETScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateRecomandation.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesPETScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await PETScanTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesPETScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await PETScanTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesPETScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await PETScanTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesPETScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await PETScanTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesPETScanerController,
  updateReportTemplatesPETScanerController,
  updateDiagnosisTemplatesPETScanerController,
  updateRecomandationTemplatesPETScanerController,
};
