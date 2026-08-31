import AngiographyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateNameofexam.js";
import AngiographyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateReport.js";
import AngiographycanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateDiagnosis.js";
import AngiographyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateRecomandation.js";
import { errorText } from "../../../../common/i18n/index.js";

// Get report template details
const detailsNameofexamTemplatesAngiographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await AngiographyScanerTemplateNameofexam.findById(
      id
    ).populate("doctor", "firstName lastName");

    if (!template) {
      return res.status(404).json({ message: "Report template not found" });
    }

    res.status(200).json(template);
  } catch (error) {
    res.status(500).json({
      message: "Error loading report template",
      error: errorText(error, req),
    });
  }
};

// Get report template details
const detailsReportTemplatesAngiographyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await AngiographyScanerTemplateReport.findById(
      id
    ).populate("doctor", "firstName lastName");

    if (!template) {
      return res.status(404).json({ message: "Report template not found" });
    }

    res.status(200).json(template);
  } catch (error) {
    res.status(500).json({
      message: "Error loading report template",
      error: errorText(error, req),
    });
  }
};

// Get diagnosis template details
const detailsDiagnosisTemplatesAngiographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await AngiographycanerTemplateDiagnosis.findById(
      id
    ).populate("doctor", "firstName lastName");

    if (!template) {
      return res.status(404).json({ message: "Diagnosis template not found" });
    }

    res.status(200).json(template);
  } catch (error) {
    res.status(500).json({
      message: "Error loading diagnosis template",
      error: errorText(error, req),
    });
  }
};

// Get recommendation template details
const detailsRecomandationTemplatesAngiographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await AngiographyScanerTemplateRecomandation.findById(
      id
    ).populate("doctor", "firstName lastName");

    if (!template) {
      return res
        .status(404)
        .json({ message: "Recommendation template not found" });
    }

    res.status(200).json(template);
  } catch (error) {
    res.status(500).json({
      message: "Error loading recommendation template",
      error: errorText(error, req),
    });
  }
};

export default {
  detailsNameofexamTemplatesAngiographyScanerController,
  detailsReportTemplatesAngiographyScanerController,
  detailsDiagnosisTemplatesAngiographyScanerController,
  detailsRecomandationTemplatesAngiographyScanerController,
};
