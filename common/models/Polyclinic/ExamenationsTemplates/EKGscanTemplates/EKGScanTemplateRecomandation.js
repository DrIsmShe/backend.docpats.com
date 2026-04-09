import mongoose from "mongoose";

const templateEKGScanSchema = new mongoose.Schema(
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
const EKGScanTemplateRecomandation = mongoose.model(
  "EKGScanTemplateRecomandation",
  templateEKGScanSchema
);

export default EKGScanTemplateRecomandation;
