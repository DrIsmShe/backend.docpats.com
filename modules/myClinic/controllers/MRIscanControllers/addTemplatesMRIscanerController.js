import MRIScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateNameofexam.js";
import MRIScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateReport.js";
import MRIScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateDiagnosis.js";
import MRIScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScanTemplateRecomandation.js";

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
  console.log(`📥 POST /MRIscaner/${label}`, req.body);

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
const addTemplateMRIscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(req, res, MRIScanTemplateNameofexam, "nameofexam");

const addTemplateMRIscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, MRIScanTemplateReport, "report");

const addTemplateMRIscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(req, res, MRIScanTemplateDiagnosis, "diagnosis");

const addTemplateMRIscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    MRIScanTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplateMRIscanerControllerNameofexam,
  addTemplateMRIscanerControllerReport,
  addTemplateMRIscanerControllerDiagnosis,
  addTemplateMRIscanerControlleRecomandation,
};
