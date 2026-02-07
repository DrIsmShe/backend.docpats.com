import CapsuleEndoscopyScannerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScanTemplateNameofexam.js";
import CapsuleEndoscopyScannerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScanTemplateReport.js";
import CapsuleEndoscopyScannerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScanTemplateDiagnosis.js";
import CapsuleEndoscopyScannerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScanTemplateRecomandation.js";

// Delete report template
const deleteNameofexamTemplatesCapsuleEndoscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted =
      await CapsuleEndoscopyScannerTemplateNameofexam.findByIdAndDelete(id);

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
const deleteReportTemplatesCapsuleEndoscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted =
      await CapsuleEndoscopyScannerTemplateReport.findByIdAndDelete(id);

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
const deleteDiagnosisTemplatesCapsuleEndoscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted =
      await CapsuleEndoscopyScannerTemplateDiagnosis.findByIdAndDelete(id);

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
const deleteRecomandationTemplatesCapsuleEndoscopyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const deleted =
      await CapsuleEndoscopyScannerTemplateRecomandation.findByIdAndDelete(id);

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
  deleteNameofexamTemplatesCapsuleEndoscopyScanerController,
  deleteReportTemplatesCapsuleEndoscopyScanerController,
  deleteDiagnosisTemplatesCapsuleEndoscopyScanerController,
  deleteRecomandationTemplatesCapsuleEndoscopyScanerController,
};
