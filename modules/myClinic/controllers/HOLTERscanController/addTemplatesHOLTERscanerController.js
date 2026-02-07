import HOLTERScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateNameofexam.js";
import HOLTERScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateReport.js";
import HOLTERScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateDiagnosis.js";
import HOLTERScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERScanTemplateRecomandation.js";

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
const addTemplateHOLTERscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    HOLTERScanerTemplateNameofexam,
    "nameofexam"
  );

const addTemplateHOLTERscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, HOLTERScanerTemplateReport, "report");

const addTemplateHOLTERscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(req, res, HOLTERScanerTemplateDiagnosis, "diagnosis");

const addTemplateHOLTERscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    HOLTERScanerTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplateHOLTERscanerControllerNameofexam,
  addTemplateHOLTERscanerControllerReport,
  addTemplateHOLTERscanerControllerDiagnosis,
  addTemplateHOLTERscanerControlleRecomandation,
};
