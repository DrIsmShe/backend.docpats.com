import CapsuleEndoscopyScannerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScanTemplateNameofexam.js";
import CapsuleEndoscopyScannerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScanTemplateReport.js";
import CapsuleEndoscopyScannerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScanTemplateDiagnosis.js";
import CapsuleEndoscopyScannerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScanTemplateRecomandation.js";

// Get report template details
const detailsNameofexamTemplatesCapsuleEndoscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await CapsuleEndoscopyScannerTemplateNameofexam.findById(
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
const detailsReportTemplatesCapsuleEndoscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await CapsuleEndoscopyScannerTemplateReport.findById(
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
const detailsDiagnosisTemplatesCapsuleEndoscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await CapsuleEndoscopyScannerTemplateDiagnosis.findById(
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
const detailsRecomandationTemplatesCapsuleEndoscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template =
      await CapsuleEndoscopyScannerTemplateRecomandation.findById(id).populate(
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
  detailsNameofexamTemplatesCapsuleEndoscopyScanerController,
  detailsReportTemplatesCapsuleEndoscopyScanerController,
  detailsDiagnosisTemplatesCapsuleEndoscopyScanerController,
  detailsRecomandationTemplatesCapsuleEndoscopyScanerController,
};
