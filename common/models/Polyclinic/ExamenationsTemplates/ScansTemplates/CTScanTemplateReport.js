import mongoose from "mongoose";

const templateCTScanSchema = new mongoose.Schema(
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

const CTScanTemplateReport =
  mongoose.models.CTScanTemplateReport ||
  mongoose.model("CTScanTemplateReport", templateCTScanSchema);

export default CTScanTemplateReport;
