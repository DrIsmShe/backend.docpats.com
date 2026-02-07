import AngiographyScanerTemplateNameofexam from "../../../../common/models/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateNameofexam.js";
import AngiographyScanerTemplateReport from "../../../../common/models/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateReport.js";
import AngiographycanerTemplateDiagnosis from "../../../../common/models/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateDiagnosis.js";
import AngiographyScanerTemplateRecomandation from "../../../../common/models/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateRecomandation.js";

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
const addTemplateAngiographyscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    AngiographyScanerTemplateNameofexam,
    "nameofexam"
  );

const addTemplateAngiographyscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, AngiographyScanerTemplateReport, "report");

const addTemplateAngiographyscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    AngiographycanerTemplateDiagnosis,
    "diagnosis"
  );

const addTemplateAngiographyscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    AngiographyScanerTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplateAngiographyscanerControllerNameofexam,
  addTemplateAngiographyscanerControllerReport,
  addTemplateAngiographyscanerControllerDiagnosis,
  addTemplateAngiographyscanerControlleRecomandation,
};
