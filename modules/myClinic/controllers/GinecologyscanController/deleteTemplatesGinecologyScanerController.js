import GinecologyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateNameofexam.js";
import GinecologyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateReport.js";
import GinecologyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyTemplatesDiagnosis.js";
import GinecologyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateRecomandation.js";

// Delete report template
const deleteNameofexamTemplatesGinecologyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted = await GinecologyScanerTemplateNameofexam.findByIdAndDelete(
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
      error: error.message,
    });
  }
};

// Delete report template
const deleteReportTemplatesGinecologyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await GinecologyScanerTemplateReport.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ message: "Report template not found" });
    }

    res
      .status(200)
      .json({ message: "✅ Report template successfully deleted" });
  } catch (error) {
    res.status(500).json({
      message: "❌ Error deleting report template",
      error: error.message,
    });
  }
};

// Delete a diagnosis template
const deleteDiagnosisTemplatesGinecologyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await GinecologyScanerTemplateDiagnosis.findByIdAndDelete(
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
      error: error.message,
    });
  }
};

// Delete recommendation template
const deleteRecomandationTemplatesGinecologyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted =
      await GinecologyScanerTemplateRecomandation.findByIdAndDelete(id);

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
      error: error.message,
    });
  }
};

export default {
  deleteNameofexamTemplatesGinecologyScanerController,
  deleteReportTemplatesGinecologyScanerController,
  deleteDiagnosisTemplatesGinecologyScanerController,
  deleteRecomandationTemplatesGinecologyScanerController,
};
