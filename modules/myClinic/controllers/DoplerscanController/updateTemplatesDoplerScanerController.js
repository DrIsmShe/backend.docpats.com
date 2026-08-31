import DoplerScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateNameofexam.js";
import DoplerScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateReport.js";
import DoplerScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateDiagnosis.js";
import DoplerScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateRecomandation.js";
import { tReq } from "../../../../common/i18n/index.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesDoplerScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await DoplerScanerTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesDoplerScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await DoplerScanerTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesDoplerScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await DoplerScanerTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesDoplerScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await DoplerScanerTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesDoplerScanerController,
  updateReportTemplatesDoplerScanerController,
  updateDiagnosisTemplatesDoplerScanerController,
  updateRecomandationTemplatesDoplerScanerController,
};
