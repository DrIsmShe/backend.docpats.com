import GinecologyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateNameofexam.js";
import GinecologyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateReport.js";
import GinecologyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyTemplatesDiagnosis.js";
import GinecologyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateRecomandation.js";

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
const addTemplateGinecologyscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    GinecologyScanerTemplateNameofexam,
    "nameofexam"
  );

const addTemplateGinecologyscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, GinecologyScanerTemplateReport, "report");

const addTemplateGinecologyscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    GinecologyScanerTemplateDiagnosis,
    "diagnosis"
  );

const addTemplateGinecologyscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    GinecologyScanerTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplateGinecologyscanerControllerNameofexam,
  addTemplateGinecologyscanerControllerReport,
  addTemplateGinecologyscanerControllerDiagnosis,
  addTemplateGinecologyscanerControlleRecomandation,
};
