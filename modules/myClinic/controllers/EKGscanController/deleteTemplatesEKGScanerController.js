import EKGScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateNameofexam.js";
import EKGScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateReport.js";
import EKGScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateDiagnosis.js";
import EKGScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGScanTemplateRecomandation.js";

// Delete report template
const deleteNameofexamTemplateEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await EKGScanerTemplateNameofexam.findByIdAndDelete(id);

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
const deleteReportTemplatesEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await EKGScanerTemplateReport.findByIdAndDelete(id);

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
const deleteDiagnosisTemplatesEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await EKGScanerTemplateDiagnosis.findByIdAndDelete(id);

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
const deleteRecomandationTemplatesEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await EKGScanerTemplateRecomandation.findByIdAndDelete(id);

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
  deleteNameofexamTemplateEKGScanerController,
  deleteReportTemplatesEKGScanerController,
  deleteDiagnosisTemplatesEKGScanerController,
  deleteRecomandationTemplatesEKGScanerController,
};
