import mongoose from "mongoose";

const templateSpirometryScanSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true },
    content: { type: String, required: true },
  },
  { timestamps: true }
);

// Создаем модель CTScan
const SpirometryScanTemplateReport = mongoose.model(
  "SpirometryScanTemplateReport",
  templateSpirometryScanSchema
);

export default SpirometryScanTemplateReport;
