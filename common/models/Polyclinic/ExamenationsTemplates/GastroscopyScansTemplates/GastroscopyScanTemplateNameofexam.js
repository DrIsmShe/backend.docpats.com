import mongoose from "mongoose";

const templateGastroscopyScanSchema = new mongoose.Schema(
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
const GastroscopyScanTemplateNameofexam = mongoose.model(
  "GastroscopyScanTemplateNameofexam",
  templateGastroscopyScanSchema
);

export default GastroscopyScanTemplateNameofexam;
