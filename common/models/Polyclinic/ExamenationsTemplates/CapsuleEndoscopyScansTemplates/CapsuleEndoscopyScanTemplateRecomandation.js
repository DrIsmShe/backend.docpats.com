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
const CapsuleEndoscopyScanTemplateRecomandation = mongoose.model(
  "CapsuleEndoscopyScanTemplateRecomandation",
  templateCapsuleEndoscopyScanSchema
);

export default CapsuleEndoscopyScanTemplateRecomandation;
