import mongoose from "mongoose";

const templateEchoEKGScanSchema = new mongoose.Schema(
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
const EchoEKGScanTemplateRecomandation = mongoose.model(
  "EchoEKGScanTemplateRecomandation",
  templateEchoEKGScanSchema
);

export default EchoEKGScanTemplateRecomandation;
