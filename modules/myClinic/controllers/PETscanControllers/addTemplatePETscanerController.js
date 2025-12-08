import PETScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateNameofexam.js";
import PETScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateReport.js";
import PETScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateDiagnosis.js";
import PETScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateRecomandation.js";

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
  console.log(`📥 POST /PETscaner/${label}`, req.body);

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
const addTemplatePETscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(req, res, PETScanTemplateNameofexam, "nameofexam");

const addTemplatePETscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, PETScanTemplateReport, "report");

const addTemplatePETscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(req, res, PETScanTemplateDiagnosis, "diagnosis");

const addTemplatePETscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    PETScanTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplatePETscanerControllerNameofexam,
  addTemplatePETscanerControllerReport,
  addTemplatePETscanerControllerDiagnosis,
  addTemplatePETscanerControlleRecomandation,
};
