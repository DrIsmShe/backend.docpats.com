import EKGScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateNameofexam.js";
import EKGScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateReport.js";
import EKGScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateDiagnosis.js";
import EKGScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateRecomandation.js";
import { tReq } from "../../../../common/i18n/index.js";
import { errorText } from "../../../../common/i18n/index.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EKGScanerTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EKGScanerTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EKGScanerTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EKGScanerTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesEKGScanerController,
  updateReportTemplatesEKGScanerController,
  updateDiagnosisTemplatesEKGScanerController,
  updateRecomandationTemplatesEKGScanerController,
};
