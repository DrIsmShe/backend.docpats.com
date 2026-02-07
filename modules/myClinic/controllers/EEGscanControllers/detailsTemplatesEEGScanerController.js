import mongoose from "mongoose";

import EEGScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateNameofexam.js";
import EEGScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateReport.js";
import EEGScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateDiagnosis.js";
import EEGScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateRecomandation.js";

// Get report template details
const detailsNameofexamTemplatesEEGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await EEGScanTemplateNameofexam.findById(id).populate(
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
const detailsReportTemplatesEEGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await EEGScanTemplateReport.findById(id).populate(
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
const detailsDiagnosisTemplatesEEGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await EEGScanTemplateDiagnosis.findById(id).populate(
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
const detailsRecomandationTemplatesEEGScanerController = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("EEG ID:", id);
    console.log("VALID ObjectId:", mongoose.Types.ObjectId.isValid(id));

    const exists = await EEGScanTemplateRecomandation.exists({ _id: id });
    console.log("EEG EXISTS IN RECOMMENDATION:", exists);

    const template = await EEGScanTemplateRecomandation.findById(id).populate(
      "doctor",
      "firstName lastName"
    );

    if (!template) {
      return res.status(404).json({
        message: "Recommendation template not found",
      });
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
  detailsNameofexamTemplatesEEGScanerController,
  detailsReportTemplatesEEGScanerController,
  detailsDiagnosisTemplatesEEGScanerController,
  detailsRecomandationTemplatesEEGScanerController,
};
