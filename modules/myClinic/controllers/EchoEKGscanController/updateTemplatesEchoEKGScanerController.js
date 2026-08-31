import EchoEKGScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateNameofexam.js";
import EchoEKGScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateReport.js";
import EchoEKGScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateDiagnosis.js";
import EchoEKGScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateRecomandation.js";
import { tReq } from "../../../../common/i18n/index.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesEchoEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EchoEKGScanerTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesEchoEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EchoEKGScanerTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesEchoEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EchoEKGScanerTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesEchoEKGScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EchoEKGScanerTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesEchoEKGScanerController,
  updateReportTemplatesEchoEKGScanerController,
  updateDiagnosisTemplatesEchoEKGScanerController,
  updateRecomandationTemplatesEchoEKGScanerController,
};
