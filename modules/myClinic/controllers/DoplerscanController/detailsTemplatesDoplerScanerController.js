import DoplerScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateNameofexam.js";
import DoplerScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateReport.js";
import DoplerScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateDiagnosis.js";
import DoplerScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateRecomandation.js";

// Get report template details
const detailsNameofexamTemplatesDoplerScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await DoplerScanerTemplateNameofexam.findById(id).populate(
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
const detailsReportTemplatesDoplerScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await DoplerScanerTemplateReport.findById(id).populate(
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
const detailsDiagnosisTemplatesDoplerScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await DoplerScanerTemplateDiagnosis.findById(id).populate(
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
const detailsRecomandationTemplatesDoplerScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await DoplerScanerTemplateRecomandation.findById(
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
  detailsNameofexamTemplatesDoplerScanerController,
  detailsReportTemplatesDoplerScanerController,
  detailsDiagnosisTemplatesDoplerScanerController,
  detailsRecomandationTemplatesDoplerScanerController,
};
