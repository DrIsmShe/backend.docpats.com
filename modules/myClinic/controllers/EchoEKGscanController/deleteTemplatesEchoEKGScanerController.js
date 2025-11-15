import EchoEKGScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateNameofexam.js";
import EchoEKGScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateReport.js";
import EchoEKGScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateDiagnosis.js";
import EchoEKGScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateRecomandation.js";

// Delete report template
const deleteNameofexamTemplateEchoEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await EchoEKGScanerTemplateNameofexam.findByIdAndDelete(id);

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
const deleteReportTemplatesEchoEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await EchoEKGScanerTemplateReport.findByIdAndDelete(id);

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
const deleteDiagnosisTemplatesEchoEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await EchoEKGScanerTemplateDiagnosis.findByIdAndDelete(id);

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

// Delete a diagnosis template
const deleteRecomandationTemplatesEchoEKGScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted = await EchoEKGScanerTemplateRecomandation.findByIdAndDelete(
      id
    );

    if (!deleted) {
      return res.status(404).json({ message: "Diagnosis template not found" });
    }

    res
      .status(200)
      .json({ message: "✅ Recommendation template successfully deleted" });
  } catch (error) {
    res.status(500).json({
      message: "❌ Error deleting diagnosis template",
      error: error.message,
    });
  }
};

export default {
  deleteNameofexamTemplateEchoEKGScanerController,
  deleteReportTemplatesEchoEKGScanerController,
  deleteDiagnosisTemplatesEchoEKGScanerController,
  deleteRecomandationTemplatesEchoEKGScanerController,
};
