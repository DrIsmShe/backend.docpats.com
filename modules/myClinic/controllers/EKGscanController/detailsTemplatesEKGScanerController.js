import EKGScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateNameofexam.js";
import EKGScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateReport.js";
import EKGScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateDiagnosis.js";
import EKGScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateRecomandation.js";

// Get report template details
const detailsNameofexamTemplatesEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await EKGScanerTemplateNameofexam.findById(id).populate(
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
const detailsReportTemplatesEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await EKGScanerTemplateReport.findById(id).populate(
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
const detailsDiagnosisTemplatesEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await EKGScanerTemplateDiagnosis.findById(id).populate(
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
const detailsRecomandationTemplatesEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await EKGScanerTemplateRecomandation.findById(id).populate(
      "doctor",
      "firstName lastName"
    );

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
  detailsNameofexamTemplatesEKGScanerController,
  detailsReportTemplatesEKGScanerController,
  detailsDiagnosisTemplatesEKGScanerController,
  detailsRecomandationTemplatesEKGScanerController,
};
