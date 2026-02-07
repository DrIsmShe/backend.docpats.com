import CoronographyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateNameofexam.js";
import CoronographyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateReport.js";
import CoronographyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateDiagnosis.js";
import CoronographyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/CoronographyScanTemplateRecomandation.js";

// Delete report template
const deleteNameofexamTemplateCoronographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted =
      await CoronographyScanerTemplateNameofexam.findByIdAndDelete(id);

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
const deleteReportTemplatesCoronographyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await CoronographyScanerTemplateReport.findByIdAndDelete(
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

// Delete a diagnosis template
const deleteDiagnosisTemplatesCoronographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted = await CoronographyScanerTemplateDiagnosis.findByIdAndDelete(
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
const deleteRecomandationTemplatesCoronographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted =
      await CoronographyScanerTemplateRecomandation.findByIdAndDelete(id);

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
  deleteNameofexamTemplateCoronographyScanerController,
  deleteReportTemplatesCoronographyScanerController,
  deleteDiagnosisTemplatesCoronographyScanerController,
  deleteRecomandationTemplatesCoronographyScanerController,
};
