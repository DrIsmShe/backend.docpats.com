import mongoose from "mongoose";

const templateMRIScanSchema = new mongoose.Schema(
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
const MRIScanTemplateReport = mongoose.model(
  "MRIScanTemplateReport",
  templateMRIScanSchema
);

export default MRIScanTemplateReport;
