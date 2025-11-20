import MRIScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateNameofexam.js";
import MRIScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateReport.js";
import MRIScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateDiagnosis.js";
import MRIScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateRecomandation.js";

// Get report template details
const detailsNameofexamTemplatesMRIScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await MRIScanerTemplateNameofexam.findById(id).populate(
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
const detailsReportTemplatesMRIScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await MRIScanerTemplateReport.findById(id).populate(
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
const detailsDiagnosisTemplatesMRIScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await MRIScanerTemplateDiagnosis.findById(id).populate(
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
const detailsRecomandationTemplatesMRIScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await MRIScanerTemplateRecomandation.findById(id).populate(
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
  detailsNameofexamTemplatesMRIScanerController,
  detailsReportTemplatesMRIScanerController,
  detailsDiagnosisTemplatesMRIScanerController,
  detailsRecomandationTemplatesMRIScanerController,
};
