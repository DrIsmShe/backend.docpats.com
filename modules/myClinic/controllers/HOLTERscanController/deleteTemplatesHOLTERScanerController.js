import HOLTERScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateNameofexam.js";
import HOLTERScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateReport.js";
import HOLTERScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateDiagnosis.js";
import HOLTERScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateRecomandation.js";

// Delete report template
const deleteNameofexamTemplatesHOLTERScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await HOLTERScanerTemplateNameofexam.findByIdAndDelete(id);

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
const deleteReportTemplatesHOLTERScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await HOLTERScanerTemplateReport.findByIdAndDelete(id);

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
const deleteDiagnosisTemplatesHOLTERScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await HOLTERScanerTemplateDiagnosis.findByIdAndDelete(id);

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
const deleteRecomandationTemplatesHOLTERScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await HOLTERScanerTemplateRecomandation.findByIdAndDelete(
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
  deleteNameofexamTemplatesHOLTERScanerController,
  deleteReportTemplatesHOLTERScanerController,
  deleteDiagnosisTemplatesHOLTERScanerController,
  deleteRecomandationTemplatesHOLTERScanerController,
};
