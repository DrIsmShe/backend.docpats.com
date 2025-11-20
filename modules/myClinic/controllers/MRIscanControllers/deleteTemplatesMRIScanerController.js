import MRIScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateNameofexam.js";
import MRIScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateReport.js";
import MRIScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateDiagnosis.js";
import MRIScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateRecomandation.js";

// Delete report template
const deleteNameofexamTemplatesMRIScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await MRIScanerTemplateNameofexam.findByIdAndDelete(id);

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
const deleteReportTemplatesMRIScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await MRIScanerTemplateReport.findByIdAndDelete(id);

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
const deleteDiagnosisTemplatesMRIScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await MRIScanerTemplateDiagnosis.findByIdAndDelete(id);

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
const deleteRecomandationTemplatesMRIScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await MRIScanerTemplateRecomandation.findByIdAndDelete(id);

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
  deleteNameofexamTemplatesMRIScanerController,
  deleteReportTemplatesMRIScanerController,
  deleteDiagnosisTemplatesMRIScanerController,
  deleteRecomandationTemplatesMRIScanerController,
};
