import GastroscopyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateNameofexam.js";
import GastroscopyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateReport.js";
import GastroscopyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateDiagnosis.js";
import GastroscopyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScanTemplateRecomandation.js";

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
const addTemplateGastroscopyscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    GastroscopyScanerTemplateNameofexam,
    "nameofexam"
  );

const addTemplateGastroscopyscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, GastroscopyScanerTemplateReport, "report");

const addTemplateGastroscopyscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    GastroscopyScanerTemplateDiagnosis,
    "diagnosis"
  );

const addTemplateGastroscopyscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    GastroscopyScanerTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplateGastroscopyscanerControllerNameofexam,
  addTemplateGastroscopyscanerControllerReport,
  addTemplateGastroscopyscanerControllerDiagnosis,
  addTemplateGastroscopyscanerControlleRecomandation,
};
