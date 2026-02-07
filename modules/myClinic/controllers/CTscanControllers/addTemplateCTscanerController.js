import CTScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateNameofexam.js";
import CTScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateReport.js";
import CTScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateDiagnosis.js";
import CTScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScanTemplateRecomandation.js";

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
  const doctorId = req.session.userId;

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
const addTemplateCTscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(req, res, CTScanTemplateNameofexam, "nameofexam");

const addTemplateCTscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, CTScanTemplateReport, "report");

const addTemplateCTscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(req, res, CTScanTemplateDiagnosis, "diagnosis");

const addTemplateCTscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    CTScanTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplateCTscanerControllerNameofexam,
  addTemplateCTscanerControllerReport,
  addTemplateCTscanerControllerDiagnosis,
  addTemplateCTscanerControlleRecomandation,
};
