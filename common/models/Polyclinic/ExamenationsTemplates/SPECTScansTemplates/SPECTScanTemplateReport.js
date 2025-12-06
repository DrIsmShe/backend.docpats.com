import mongoose from "mongoose";

const templateSPECTScanSchema = new mongoose.Schema(
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
const SPECTScanTemplateReport = mongoose.model(
  " SPECTScanTemplateReport",
  templateSPECTScanSchema
);

export default SPECTScanTemplateReport;
