import mongoose from "mongoose";
import gastroscopyTemplateSchema from "./gastroscopyTemplate.schema.js";

const GastroscopyScanTemplateNameofexam = mongoose.model(
  "GastroscopyScanTemplateNameofexam",
  gastroscopyTemplateSchema,
  "gastroscopy_nameofexam_templates"
);

export default GastroscopyScanTemplateNameofexam;
