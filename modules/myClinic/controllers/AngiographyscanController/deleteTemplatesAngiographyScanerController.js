import AngiographyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateNameofexam.js";
import AngiographyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateReport.js";
import AngiographycanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateDiagnosis.js";
import AngiographyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateRecomandation.js";
import { errorText } from "../../../../common/i18n/index.js";

// Delete report template
const deleteNameofexamTemplateAngiographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted = await AngiographyScanerTemplateNameofexam.findByIdAndDelete(
      id
    );

    if (!deleted) {
      return res.status(404).json({ message: "Report template not found" });
    }

    res
      .status(200)
      .json({ message: "✅ Report template successfully deleted" });
  } catch (error) {
    res.status(500).json({
      message: "❌ Error deleting report template",
      error: errorText(error, req),
    });
  }
};

// Delete report template
const deleteReportTemplatesAngiographyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await AngiographyScanerTemplateReport.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ message: "Report template not found" });
    }

    res
      .status(200)
      .json({ message: "✅ Report template successfully deleted" });
  } catch (error) {
    res.status(500).json({
      message: "❌ Error deleting report template",
      error: errorText(error, req),
    });
  }
};

// Delete a diagnosis template
const deleteDiagnosisTemplatesAngiographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted = await AngiographycanerTemplateDiagnosis.findByIdAndDelete(
      id
    );

    if (!deleted) {
      return res.status(404).json({ message: "Diagnosis template not found" });
    }

    res
      .status(200)
      .json({ message: "✅ Diagnosis template successfully deleted" });
  } catch (error) {
    res.status(500).json({
      message: "❌ Error deleting diagnosis template",
      error: errorText(error, req),
    });
  }
};

// Delete recommendation template
const deleteRecomandationTemplatesAngiographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted =
      await AngiographyScanerTemplateRecomandation.findByIdAndDelete(id);

    if (!deleted) {
      return res
        .status(404)
        .json({ message: "Recommendation template not found" });
    }

    res
      .status(200)
      .json({ message: "✅ Recommendation template successfully deleted" });
  } catch (error) {
    res.status(500).json({
      message: "❌ Error deleting recommendation template",
      error: errorText(error, req),
    });
  }
};

export default {
  deleteNameofexamTemplateAngiographyScanerController,
  deleteReportTemplatesAngiographyScanerController,
  deleteDiagnosisTemplatesAngiographyScanerController,
  deleteRecomandationTemplatesAngiographyScanerController,
};
