import USMScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateNameofexam.js";
import USMScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateReport.js";
import USMScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateDiagnosis.js";
import USMScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateRecomandation.js";

// Get report template details
const detailsNameofexamTemplatesUSMScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await USMScanerTemplateNameofexam.findById(id).populate(
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
const detailsReportTemplatesUSMScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await USMScanerTemplateReport.findById(id).populate(
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
const detailsDiagnosisTemplatesUSMScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await USMScanerTemplateDiagnosis.findById(id).populate(
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
const detailsRecomandationTemplatesUSMScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await USMScanerTemplateRecomandation.findById(id).populate(
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
  detailsNameofexamTemplatesUSMScanerController,
  detailsReportTemplatesUSMScanerController,
  detailsDiagnosisTemplatesUSMScanerController,
  detailsRecomandationTemplatesUSMScanerController,
};
