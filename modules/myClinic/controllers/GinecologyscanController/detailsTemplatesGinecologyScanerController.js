import GinecologyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateNameofexam.js";
import GinecologyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateReport.js";
import GinecologyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyTemplatesDiagnosis.js";
import GinecologyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateRecomandation.js";
import { errorText } from "../../../../common/i18n/index.js";

// Get report template details
const detailsNameofexamTemplatesGinecologyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await GinecologyScanerTemplateNameofexam.findById(
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
const detailsReportTemplatesGinecologyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await GinecologyScanerTemplateReport.findById(id).populate(
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
const detailsDiagnosisTemplatesGinecologyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await GinecologyScanerTemplateDiagnosis.findById(
      id
    ).populate("doctor", "firstName lastName");

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
const detailsRecomandationTemplatesGinecologyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const template = await GinecologyScanerTemplateRecomandation.findById(
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
  detailsNameofexamTemplatesGinecologyScanerController,
  detailsReportTemplatesGinecologyScanerController,
  detailsDiagnosisTemplatesGinecologyScanerController,
  detailsRecomandationTemplatesGinecologyScanerController,
};
