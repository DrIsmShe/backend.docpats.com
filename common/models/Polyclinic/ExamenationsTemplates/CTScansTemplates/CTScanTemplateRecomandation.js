import mongoose from "mongoose";

const templateCTScanSchema = new mongoose.Schema(
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
const CTScanTemplateRecomandation = mongoose.model(
  "CTScanTemplateRecomandation",
  templateCTScanSchema
);

export default CTScanTemplateRecomandation;
