import mongoose from "mongoose";

const templateCapsuleEndoscopyScanSchema = new mongoose.Schema(
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
const CapsuleEndoscopyScanTemplateNameofexam = mongoose.model(
  "CapsuleEndoscopyScanTemplateNameofexam",
  templateCapsuleEndoscopyScanSchema
);

export default CapsuleEndoscopyScanTemplateNameofexam;
