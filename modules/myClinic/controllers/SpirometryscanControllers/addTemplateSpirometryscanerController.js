import SpirometryScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateNameofexam.js";
import SpirometryScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateReport.js";
import SpirometryScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateDiagnosis.js";
import SpirometryScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScanTemplateRecomandation.js";

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
const addTemplateSpirometryscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    SpirometryScanTemplateNameofexam,
    "nameofexam"
  );

const addTemplateSpirometryscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, SpirometryScanTemplateReport, "report");

const addTemplateSpirometryscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    SpirometryScanTemplateDiagnosis,
    "diagnosis"
  );

const addTemplateSpirometryscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    SpirometryScanTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplateSpirometryscanerControllerNameofexam,
  addTemplateSpirometryscanerControllerReport,
  addTemplateSpirometryscanerControllerDiagnosis,
  addTemplateSpirometryscanerControlleRecomandation,
};
