import CoronographyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateNameofexam.js";
import CoronographyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateReport.js";
import CoronographyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateDiagnosis.js";
import CoronographyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateRecomandation.js";

// Get report template details
const detailsNameofexamTemplatesCoronographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await CoronographyScanerTemplateNameofexam.findById(
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
const detailsReportTemplatesCoronographyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await CoronographyScanerTemplateReport.findById(
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
const detailsDiagnosisTemplatesCoronographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await CoronographyScanerTemplateDiagnosis.findById(
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
const detailsRecomandationTemplatesCoronographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await CoronographyScanerTemplateRecomandation.findById(
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
  detailsNameofexamTemplatesCoronographyScanerController,
  detailsReportTemplatesCoronographyScanerController,
  detailsDiagnosisTemplatesCoronographyScanerController,
  detailsRecomandationTemplatesCoronographyScanerController,
};
