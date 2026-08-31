import XRAYScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateNameofexams.js";
import XRAYScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateReports.js";
import XRAYScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateDiagnos.js";
import XRAYScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateRecomandations.js";
import { tReq } from "../../../../common/i18n/index.js";
import { errorText } from "../../../../common/i18n/index.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesXRAYScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await XRAYScanTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesXRAYScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await XRAYScanTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesXRAYScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await XRAYScanTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesXRAYScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await XRAYScanTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesXRAYScanerController,
  updateReportTemplatesXRAYScanerController,
  updateDiagnosisTemplatesXRAYScanerController,
  updateRecomandationTemplatesXRAYScanerController,
};
