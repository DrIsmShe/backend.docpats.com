import mongoose from "mongoose";

const templateXRayScanSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      trim: true,
    },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

const XRayScanTemplateDiagnosis =
  mongoose.models.XRayScanTemplateDiagnosis ||
  mongoose.model("XRayScanTemplateDiagnosis", templateXRayScanSchema);

export default XRayScanTemplateDiagnosis;
