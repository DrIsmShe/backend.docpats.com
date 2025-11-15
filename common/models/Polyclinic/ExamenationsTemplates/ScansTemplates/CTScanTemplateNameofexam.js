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

const CTScanTemplateNameofexam =
  mongoose.models.CTScanTemplateNameofexam ||
  mongoose.model("CTScanTemplateNameofexam", templateCTScanSchema);

export default CTScanTemplateNameofexam;
