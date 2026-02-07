import mongoose from "mongoose";

const templateGinecologyScanSchema = new mongoose.Schema(
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
const GinecologyScanTemplateRecomandation = mongoose.model(
  "GinecologyScanTemplateRecomandation",
  templateGinecologyScanSchema
);

export default GinecologyScanTemplateRecomandation;
