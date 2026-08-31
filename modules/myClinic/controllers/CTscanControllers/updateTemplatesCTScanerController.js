import CTScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateNameofexam.js";
import CTScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateReport.js";
import CTScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateDiagnosis.js";
import CTScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateRecomandation.js";
import { tReq } from "../../../../common/i18n/index.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesCTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await CTScanTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesCTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await CTScanTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesCTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await CTScanTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesCTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await CTScanTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesCTScanerController,
  updateReportTemplatesCTScanerController,
  updateDiagnosisTemplatesCTScanerController,
  updateRecomandationTemplatesCTScanerController,
};
