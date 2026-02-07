import SPECTScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScanTemplateNameofexam.js";
import SPECTScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScanTemplateReport.js";
import SPECTScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTSchemaTemplateDiagnosis.js";
import SPECTScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScanTemplateRecomandation.js";

// Delete report template
const deleteNameofexamTemplatesSPECTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await SPECTScanTemplateNameofexam.findByIdAndDelete(id);

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
const deleteReportTemplatesSPECTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await SPECTScanTemplateReport.findByIdAndDelete(id);

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
const deleteDiagnosisTemplatesSPECTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await SPECTScanTemplateDiagnosis.findByIdAndDelete(id);

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
const deleteRecomandationTemplatesSPECTScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await SPECTScanTemplateRecomandation.findByIdAndDelete(id);

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
  deleteNameofexamTemplatesSPECTScanerController,
  deleteReportTemplatesSPECTScanerController,
  deleteDiagnosisTemplatesSPECTScanerController,
  deleteRecomandationTemplatesSPECTScanerController,
};
