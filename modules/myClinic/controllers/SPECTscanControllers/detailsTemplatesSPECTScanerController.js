import SPECTScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScanTemplateNameofexam.js";
import SPECTScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScanTemplateReport.js";
import SPECTScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTSchemaTemplateDiagnosis.js";
import SPECTScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScanTemplateRecomandation.js";

// Get report template details
const detailsNameofexamTemplatesSPECTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await SPECTScanTemplateNameofexam.findById(id).populate(
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
const detailsReportTemplatesSPECTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await SPECTScanTemplateReport.findById(id).populate(
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
const detailsDiagnosisTemplatesSPECTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await SPECTScanTemplateDiagnosis.findById(id).populate(
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
const detailsRecomandationTemplatesSPECTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await SPECTScanTemplateRecomandation.findById(id).populate(
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
  detailsNameofexamTemplatesSPECTScanerController,
  detailsReportTemplatesSPECTScanerController,
  detailsDiagnosisTemplatesSPECTScanerController,
  detailsRecomandationTemplatesSPECTScanerController,
};
