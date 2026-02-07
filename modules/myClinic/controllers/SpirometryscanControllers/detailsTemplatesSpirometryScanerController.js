import SpirometryScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateNameofexam.js";
import SpirometryScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateReport.js";
import SpirometryScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateDiagnosis.js";
import SpirometryScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateRecomandation.js";

// Get report template details
const detailsNameofexamTemplatesSpirometryScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await SpirometryScanTemplateNameofexam.findById(
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
const detailsReportTemplatesSpirometryScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await SpirometryScanTemplateReport.findById(id).populate(
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
const detailsDiagnosisTemplatesSpirometryScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await SpirometryScanTemplateDiagnosis.findById(
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
const detailsRecomandationTemplatesSpirometryScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await SpirometryScanTemplateRecomandation.findById(
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
  detailsNameofexamTemplatesSpirometryScanerController,
  detailsReportTemplatesSpirometryScanerController,
  detailsDiagnosisTemplatesSpirometryScanerController,
  detailsRecomandationTemplatesSpirometryScanerController,
};
