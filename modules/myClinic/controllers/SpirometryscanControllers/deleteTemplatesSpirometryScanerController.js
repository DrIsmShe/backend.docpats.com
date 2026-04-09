import SpirometryScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateNameofexam.js";
import SpirometryScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateReport.js";
import SpirometryScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateDiagnosis.js";
import SpirometryScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateRecomandation.js";

// Delete report template
const deleteNameofexamTemplatesSpirometryScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted = await SpirometryScanTemplateNameofexam.findByIdAndDelete(
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
const deleteReportTemplatesSpirometryScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await SpirometryScanTemplateReport.findByIdAndDelete(id);

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
const deleteDiagnosisTemplatesSpirometryScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await SpirometryScanTemplateDiagnosis.findByIdAndDelete(id);

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
const deleteRecomandationTemplatesSpirometryScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted = await SpirometryScanTemplateRecomandation.findByIdAndDelete(
      id
    );

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
  deleteNameofexamTemplatesSpirometryScanerController,
  deleteReportTemplatesSpirometryScanerController,
  deleteDiagnosisTemplatesSpirometryScanerController,
  deleteRecomandationTemplatesSpirometryScanerController,
};
