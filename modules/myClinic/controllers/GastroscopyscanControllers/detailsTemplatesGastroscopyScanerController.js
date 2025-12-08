import GastroscopyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateNameofexam.js";
import GastroscopyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateReport.js";
import GastroscopyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateDiagnosis.js";
import GastroscopyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateRecomandation.js";

// Get report template details
const detailsNameofexamTemplatesGastroscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await GastroscopyScanerTemplateNameofexam.findById(
      id
    ).populate("doctor", "firstName lastName");

    if (!template) {
      return res.status(404).json({ message: "Report template not found" });
    }

    res.status(200).json(template);
  } catch (error) {
    res.status(500).json({
      message: "Error loading report template",
      error: error.message,
    });
  }
};

// Get report template details
const detailsReportTemplatesGastroscopyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await GastroscopyScanerTemplateReport.findById(
      id
    ).populate("doctor", "firstName lastName");

    if (!template) {
      return res.status(404).json({ message: "Report template not found" });
    }

    res.status(200).json(template);
  } catch (error) {
    res.status(500).json({
      message: "Error loading report template",
      error: error.message,
    });
  }
};

// Get diagnosis template details
const detailsDiagnosisTemplatesGastroscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await GastroscopyScanerTemplateDiagnosis.findById(
      id
    ).populate("doctor", "firstName lastName");

    if (!template) {
      return res.status(404).json({ message: "Diagnosis template not found" });
    }

    res.status(200).json(template);
  } catch (error) {
    res.status(500).json({
      message: "Error loading diagnosis template",
      error: error.message,
    });
  }
};

// Get recommendation template details
const detailsRecomandationTemplatesGastroscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await GastroscopyScanerTemplateRecomandation.findById(
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
      error: error.message,
    });
  }
};

export default {
  detailsNameofexamTemplatesGastroscopyScanerController,
  detailsReportTemplatesGastroscopyScanerController,
  detailsDiagnosisTemplatesGastroscopyScanerController,
  detailsRecomandationTemplatesGastroscopyScanerController,
};
