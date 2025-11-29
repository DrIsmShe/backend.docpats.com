import EEGScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateNameofexam.js";
import EEGScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateReport.js";
import EEGScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateDiagnosis.js";
import EEGScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateRecomandation.js";

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
const addTemplateEEGscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(req, res, EEGScanTemplateNameofexam, "nameofexam");

const addTemplateEEGscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, EEGScanTemplateReport, "report");

const addTemplateEEGscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(req, res, EEGScanTemplateDiagnosis, "diagnosis");

const addTemplateEEGscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    EEGScanTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplateEEGscanerControllerNameofexam,
  addTemplateEEGscanerControllerReport,
  addTemplateEEGscanerControllerDiagnosis,
  addTemplateEEGscanerControlleRecomandation,
};
