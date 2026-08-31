import SPECTScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScanTemplateNameofexam.js";
import SPECTScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScanTemplateReport.js";
import SPECTScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTSchemaTemplateDiagnosis.js";
import SPECTScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScanTemplateRecomandation.js";
import { tReq } from "../../../../common/i18n/index.js";
import { errorText } from "../../../../common/i18n/index.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesSPECTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await SPECTScanTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesSPECTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await SPECTScanTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesSPECTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await SPECTScanTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesSPECTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await SPECTScanTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesSPECTScanerController,
  updateReportTemplatesSPECTScanerController,
  updateDiagnosisTemplatesSPECTScanerController,
  updateRecomandationTemplatesSPECTScanerController,
};
