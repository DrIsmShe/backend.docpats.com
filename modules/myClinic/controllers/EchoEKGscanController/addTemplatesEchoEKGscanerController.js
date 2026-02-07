import EchoEKGScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateNameofexam.js";
import EchoEKGScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateReport.js";
import EchoEKGScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateDiagnosis.js";
import EchoEKGScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateRecomandation.js";

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
const addTemplateEchoEKGscanerControllerNameofexam = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    EchoEKGScanerTemplateNameofexam,
    "nameofexam"
  );

const addTemplateEchoEKGscanerControllerReport = (req, res) =>
  handleTemplateCreation(req, res, EchoEKGScanerTemplateReport, "report");

const addTemplateEchoEKGscanerControllerDiagnosis = (req, res) =>
  handleTemplateCreation(req, res, EchoEKGScanerTemplateDiagnosis, "diagnosis");

const addTemplateEchoEKGscanerControlleRecomandation = (req, res) =>
  handleTemplateCreation(
    req,
    res,
    EchoEKGScanerTemplateRecomandation,
    "recommendations"
  );

export default {
  addTemplateEchoEKGscanerControllerNameofexam,
  addTemplateEchoEKGscanerControllerReport,
  addTemplateEchoEKGscanerControllerDiagnosis,
  addTemplateEchoEKGscanerControlleRecomandation,
};
