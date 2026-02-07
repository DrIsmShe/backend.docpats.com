import mongoose from "mongoose";

const templatePETScanSchema = new mongoose.Schema(
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
const PETScanTemplateNameofexam = mongoose.model(
  " PETScanTemplateNameofexam",
  templatePETScanSchema
);

export default PETScanTemplateNameofexam;
