import mongoose from "mongoose";

const templateCTScanSchema = new mongoose.Schema(
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

const CTScanTemplateDiagnosis =
  mongoose.models.CTScanTemplateDiagnosis ||
  mongoose.model("CTScanTemplateDiagnosis", templateCTScanSchema);

export default CTScanTemplateDiagnosis;
