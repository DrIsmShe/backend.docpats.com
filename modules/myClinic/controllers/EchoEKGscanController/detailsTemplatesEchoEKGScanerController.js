import EchoEKGScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateNameofexam.js";
import EchoEKGScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateReport.js";
import EchoEKGScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateDiagnosis.js";
import EchoEKGScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateRecomandation.js";
import { errorText } from "../../../../common/i18n/index.js";

// Get report template details
const detailsNameofexamTemplatesEchoEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await EchoEKGScanerTemplateNameofexam.findById(
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
const detailsReportTemplatesEchoEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await EchoEKGScanerTemplateReport.findById(id).populate(
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
const detailsDiagnosisTemplatesEchoEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await EchoEKGScanerTemplateDiagnosis.findById(id).populate(
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
const detailsRecomandationTemplatesEchoEKGScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await EchoEKGScanerTemplateRecomandation.findById(
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
  detailsNameofexamTemplatesEchoEKGScanerController,
  detailsReportTemplatesEchoEKGScanerController,
  detailsDiagnosisTemplatesEchoEKGScanerController,
  detailsRecomandationTemplatesEchoEKGScanerController,
};
