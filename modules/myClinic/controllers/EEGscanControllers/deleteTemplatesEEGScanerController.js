import EEGScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateNameofexam.js";
import EEGScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateReport.js";
import EEGScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateDiagnosis.js";
import EEGScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateRecomandation.js";

// Delete report template
const deleteNameofexamTemplatesEEGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await EEGScanTemplateNameofexam.findByIdAndDelete(id);

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
const deleteReportTemplatesEEGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await EEGScanTemplateReport.findByIdAndDelete(id);

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
const deleteDiagnosisTemplatesEEGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await EEGScanTemplateDiagnosis.findByIdAndDelete(id);

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
const deleteRecomandationTemplatesEEGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await EEGScanTemplateRecomandation.findByIdAndDelete(id);

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
  deleteNameofexamTemplatesEEGScanerController,
  deleteReportTemplatesEEGScanerController,
  deleteDiagnosisTemplatesEEGScanerController,
  deleteRecomandationTemplatesEEGScanerController,
};
