import mongoose from "mongoose";
import gastroscopyTemplateSchema from "./gastroscopyTemplate.schema.js";

const GastroscopyScanTemplateRecomandation = mongoose.model(
  "GastroscopyScanTemplateRecomandation",
  gastroscopyTemplateSchema,
  "gastroscopy_recomandation_templates"
);

export default GastroscopyScanTemplateRecomandation;
