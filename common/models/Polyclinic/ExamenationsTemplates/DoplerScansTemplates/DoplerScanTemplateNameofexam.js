import mongoose from "mongoose";

const templateDoplerScanSchema = new mongoose.Schema(
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
const DoplerScanTemplateNameofexam = mongoose.model(
  "DoplerScanTemplateNameofexam",
  templateDoplerScanSchema
);

export default DoplerScanTemplateNameofexam;
