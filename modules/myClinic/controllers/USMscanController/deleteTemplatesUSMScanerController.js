import USMScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateNameofexam.js";
import USMScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateReport.js";
import USMScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateDiagnosis.js";
import USMScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateRecomandation.js";
import { errorText } from "../../../../common/i18n/index.js";

// Delete report template
const deleteNameofexamTemplatesUSMScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await USMScanerTemplateNameofexam.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ message: "Report template not found" });
    }

    res
      .status(200)
      .json({ message: "✅ Report template successfully deleted" });
  } catch (error) {
    res.status(500).json({
      message: "❌ Error deleting report template",
      error: errorText(error, req),
    });
  }
};

// Delete report template
const deleteReportTemplatesUSMScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await USMScanerTemplateReport.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ message: "Report template not found" });
    }

    res
      .status(200)
      .json({ message: "✅ Report template successfully deleted" });
  } catch (error) {
    res.status(500).json({
      message: "❌ Error deleting report template",
      error: errorText(error, req),
    });
  }
};

// Delete a diagnosis template
const deleteDiagnosisTemplatesUSMScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await USMScanerTemplateDiagnosis.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ message: "Diagnosis template not found" });
    }

    res
      .status(200)
      .json({ message: "✅ Diagnosis template successfully deleted" });
  } catch (error) {
    res.status(500).json({
      message: "❌ Error deleting diagnosis template",
      error: errorText(error, req),
    });
  }
};

// Delete recommendation template
const deleteRecomandationTemplatesUSMScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await USMScanerTemplateRecomandation.findByIdAndDelete(id);

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
      error: errorText(error, req),
    });
  }
};

export default {
  deleteNameofexamTemplatesUSMScanerController,
  deleteReportTemplatesUSMScanerController,
  deleteDiagnosisTemplatesUSMScanerController,
  deleteRecomandationTemplatesUSMScanerController,
};
