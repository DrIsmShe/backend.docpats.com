import USMScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateNameofexam.js";
import USMScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateReport.js";
import USMScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateDiagnosis.js";
import USMScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMScanTemplateRecomandation.js";

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
const addTemplateUSMscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(req, res, USMScanerTemplateNameofexam, "nameofexam");

const addTemplateUSMscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, USMScanerTemplateReport, "report");

const addTemplateUSMscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(req, res, USMScanerTemplateDiagnosis, "diagnosis");

const addTemplateUSMscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    USMScanerTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplateUSMscanerControllerNameofexam,
  addTemplateUSMscanerControllerReport,
  addTemplateUSMscanerControllerDiagnosis,
  addTemplateUSMscanerControlleRecomandation,
};
