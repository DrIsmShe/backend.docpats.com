import PETScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateNameofexam.js";
import PETScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateReport.js";
import PETScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateDiagnosis.js";
import PETScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateRecomandation.js";

// Delete report template
const deleteNameofexamTemplatesPETScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await PETScanTemplateNameofexam.findByIdAndDelete(id);

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
const deleteReportTemplatesPETScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await PETScanTemplateReport.findByIdAndDelete(id);

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
const deleteDiagnosisTemplatesPETScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await PETScanTemplateDiagnosis.findByIdAndDelete(id);

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
const deleteRecomandationTemplatesPETScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await PETScanTemplateRecomandation.findByIdAndDelete(id);

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
  deleteNameofexamTemplatesPETScanerController,
  deleteReportTemplatesPETScanerController,
  deleteDiagnosisTemplatesPETScanerController,
  deleteRecomandationTemplatesPETScanerController,
};
