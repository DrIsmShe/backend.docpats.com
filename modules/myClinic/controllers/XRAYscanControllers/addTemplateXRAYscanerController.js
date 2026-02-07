import XRAYScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateNameofexams.js";
import XRAYScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateReports.js";
import XRAYScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateDiagnos.js";
import XRAYScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateRecomandations.js";

const validateInput = (title, content) => {
  const errors = [];
  if (!title || typeof title !== "string" || title.trim() === "") {
    errors.push("Invalid or missing field 'title'");
  }
  if (!content || typeof content !== "string" || content.trim() === "") {
    errors.push("Invalid or missing field 'content'");
  }
  return errors;
};

const handleTemplateCreation = async (req, res, Model, label) => {
  console.log(`📥 POST /CTscaner/${label}`, req.body);

  const { title, content } = req.body;
  const doctorId = req.session?.userId;
  const errors = validateInput(title, content);

  if (!doctorId) {
    console.warn("⛔ No userId in session!");
    return res.status(401).json({ message: "You are not logged in" });
  }

  if (errors.length) {
    console.warn("❌ Validation error:", errors);
    return res.status(400).json({ message: "Validation error", errors });
  }

  try {
    const newTemplate = new Model({
      doctor: doctorId,

      title,
      content,
    });

    await newTemplate.save();

    console.log(`✅ ${label} template added:`, newTemplate._id);
    return res.status(201).json({
      message: `${label} template added successfully`,
      template: newTemplate,
    });
  } catch (error) {
    console.error(`💥 Error saving template ${label}:`, error);
    return res.status(500).json({
      message: `Error adding template ${label}`,
      error,
    });
  }
};
const addTemplateXRAYscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(req, res, XRAYScanTemplateNameofexam, "nameofexam");

const addTemplateXRAYscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, XRAYScanTemplateReport, "report");

const addTemplateXRAYscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(req, res, XRAYScanTemplateDiagnosis, "diagnosis");

const addTemplateXRAYscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    XRAYScanTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplateXRAYscanerControllerNameofexam,
  addTemplateXRAYscanerControllerReport,
  addTemplateXRAYscanerControllerDiagnosis,
  addTemplateXRAYscanerControlleRecomandation,
};
