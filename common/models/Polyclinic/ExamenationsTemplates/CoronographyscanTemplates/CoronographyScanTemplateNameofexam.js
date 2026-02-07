import mongoose from "mongoose";

const templateCoronographyScanSchema = new mongoose.Schema(
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
const CoronographyScanTemplateNameofexam = mongoose.model(
  "CoronographyScanTemplateNameofexam",
  templateCoronographyScanSchema
);

export default CoronographyScanTemplateNameofexam;
