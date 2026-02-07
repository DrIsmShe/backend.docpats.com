import mongoose from "mongoose";
import gastroscopyTemplateSchema from "./gastroscopyTemplate.schema.js";

const GastroscopyScanTemplateDiagnosis = mongoose.model(
  "GastroscopyScanTemplateDiagnosis",
  gastroscopyTemplateSchema,
  "gastroscopy_diagnosis_templates"
);

export default GastroscopyScanTemplateDiagnosis;
