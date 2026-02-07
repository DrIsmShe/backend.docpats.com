import DoplerScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateNameofexam.js";
import DoplerScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateReport.js";
import DoplerScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateDiagnosis.js";
import DoplerScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScanTemplateRecomandation.js";

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
  console.log(`📥 POST /USMscaner/${label}`, req.body);

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
const addTemplateDoplerscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    DoplerScanerTemplateNameofexam,
    "nameofexam"
  );

const addTemplateDoplerscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, DoplerScanerTemplateReport, "report");

const addTemplateDoplerscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(req, res, DoplerScanerTemplateDiagnosis, "diagnosis");

const addTemplateDoplerscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    DoplerScanerTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplateDoplerscanerControllerNameofexam,
  addTemplateDoplerscanerControllerReport,
  addTemplateDoplerscanerControllerDiagnosis,
  addTemplateDoplerscanerControlleRecomandation,
};
