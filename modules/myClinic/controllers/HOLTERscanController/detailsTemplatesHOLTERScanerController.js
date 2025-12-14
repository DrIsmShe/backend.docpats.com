import HOLTERScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateNameofexam.js";
import HOLTERScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateReport.js";
import HOLTERScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateDiagnosis.js";
import HOLTERScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateRecomandation.js";

// Get report template details
const detailsNameofexamTemplatesHOLTERScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await HOLTERScanerTemplateNameofexam.findById(id).populate(
      "doctor",
      "firstName lastName"
    );

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
const detailsReportTemplatesHOLTERScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await HOLTERScanerTemplateReport.findById(id).populate(
      "doctor",
      "firstName lastName"
    );

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
const detailsDiagnosisTemplatesHOLTERScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await HOLTERScanerTemplateDiagnosis.findById(id).populate(
      "doctor",
      "firstName lastName"
    );

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
const detailsRecomandationTemplatesHOLTERScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await HOLTERScanerTemplateRecomandation.findById(
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
  detailsNameofexamTemplatesHOLTERScanerController,
  detailsReportTemplatesHOLTERScanerController,
  detailsDiagnosisTemplatesHOLTERScanerController,
  detailsRecomandationTemplatesHOLTERScanerController,
};
