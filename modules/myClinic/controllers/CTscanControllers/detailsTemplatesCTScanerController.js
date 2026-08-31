import CTScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateNameofexam.js";
import CTScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateReport.js";
import CTScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateDiagnosis.js";
import CTScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateRecomandation.js";
import { errorText } from "../../../../common/i18n/index.js";

// Get report template details
const detailsNameofexamTemplatesCTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await CTScanTemplateNameofexam.findById(id).populate(
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
      error: errorText(error, req),
    });
  }
};

// Get report template details
const detailsReportTemplatesCTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await CTScanTemplateReport.findById(id).populate(
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
      error: errorText(error, req),
    });
  }
};

// Get diagnosis template details
const detailsDiagnosisTemplatesCTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await CTScanTemplateDiagnosis.findById(id).populate(
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
      error: errorText(error, req),
    });
  }
};

// Get recommendation template details
const detailsRecomandationTemplatesCTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await CTScanTemplateRecomandation.findById(id).populate(
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
      error: errorText(error, req),
    });
  }
};

export default {
  detailsNameofexamTemplatesCTScanerController,
  detailsReportTemplatesCTScanerController,
  detailsDiagnosisTemplatesCTScanerController,
  detailsRecomandationTemplatesCTScanerController,
};
