import mongoose from "mongoose";

const templateHOLTERScanSchema = new mongoose.Schema(
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
const HOLTERScanTemplateNameofexam = mongoose.model(
  "HOLTERScanTemplateNameofexam",
  templateHOLTERScanSchema
);

export default HOLTERScanTemplateNameofexam;
