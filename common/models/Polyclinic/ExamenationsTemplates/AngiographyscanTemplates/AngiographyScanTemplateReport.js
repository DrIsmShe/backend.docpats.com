import mongoose from "mongoose";

const templateAngiographyScanSchema = new mongoose.Schema(
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
const AngiographyScanTemplateReport = mongoose.model(
  "AngiographyScanTemplateReport",
  templateAngiographyScanSchema
);

export default AngiographyScanTemplateReport;
