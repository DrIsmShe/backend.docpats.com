import DoplerScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateNameofexam.js";
import DoplerScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateReport.js";
import DoplerScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateDiagnosis.js";
import DoplerScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateRecomandation.js";

// Delete report template
const deleteNameofexamTemplatesDoplerScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await DoplerScanerTemplateNameofexam.findByIdAndDelete(id);

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
const deleteReportTemplatesDoplerScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await DoplerScanerTemplateReport.findByIdAndDelete(id);

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
const deleteDiagnosisTemplatesDoplerScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await DoplerScanerTemplateDiagnosis.findByIdAndDelete(id);

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
const deleteRecomandationTemplatesDoplerScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await DoplerScanerTemplateRecomandation.findByIdAndDelete(
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
  deleteNameofexamTemplatesDoplerScanerController,
  deleteReportTemplatesDoplerScanerController,
  deleteDiagnosisTemplatesDoplerScanerController,
  deleteRecomandationTemplatesDoplerScanerController,
};
