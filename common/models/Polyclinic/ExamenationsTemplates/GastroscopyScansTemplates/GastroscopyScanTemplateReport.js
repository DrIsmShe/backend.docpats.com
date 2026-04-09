import mongoose from "mongoose";
import gastroscopyTemplateSchema from "./gastroscopyTemplate.schema.js";

const GastroscopyScanTemplateReport = mongoose.model(
  "GastroscopyScanTemplateReport",
  gastroscopyTemplateSchema,
  "gastroscopy_report_templates"
);

export default GastroscopyScanTemplateReport;
