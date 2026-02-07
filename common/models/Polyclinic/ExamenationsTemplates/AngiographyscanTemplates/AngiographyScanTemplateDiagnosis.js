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
const AngiographyScanTemplateDiagnosis = mongoose.model(
  "AngiographyScanTemplateDiagnosis",
  templateAngiographyScanSchema
);

export default AngiographyScanTemplateDiagnosis;
