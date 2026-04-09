import mongoose from "mongoose";

const templateEEGScanSchema = new mongoose.Schema(
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
const EEGScanTemplateRecomandation = mongoose.model(
  "EEGScanTemplateRecomandation",
  templateEEGScanSchema
);

export default EEGScanTemplateRecomandation;
