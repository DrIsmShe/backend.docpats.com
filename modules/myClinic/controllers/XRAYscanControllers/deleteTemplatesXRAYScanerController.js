import XRAYScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateNameofexams.js";

import XRAYScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateReports.js";
import XRAYScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateRecomandations.js";
import XRAYScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateRecomandations.js";

// Delete report template
const deleteNameofexamTemplatesXRAYScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await XRAYScanTemplateNameofexam.findByIdAndDelete(id);

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
const deleteReportTemplatesXRAYScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await XRAYScanTemplateReport.findByIdAndDelete(id);

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
const deleteDiagnosisTemplatesXRAYScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await XRAYScanTemplateDiagnosis.findByIdAndDelete(id);

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
const deleteRecomandationTemplatesXRAYScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await XRAYScanTemplateRecomandation.findByIdAndDelete(id);

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
  deleteNameofexamTemplatesXRAYScanerController,
  deleteReportTemplatesXRAYScanerController,
  deleteDiagnosisTemplatesXRAYScanerController,
  deleteRecomandationTemplatesXRAYScanerController,
};
