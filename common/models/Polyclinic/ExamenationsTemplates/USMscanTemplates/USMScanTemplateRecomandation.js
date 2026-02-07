import mongoose from "mongoose";

const templateUSMScanSchema = new mongoose.Schema(
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
const USMScanTemplateRecomandation = mongoose.model(
  "USMScanTemplateRecomandation",
  templateUSMScanSchema
);

export default USMScanTemplateRecomandation;
