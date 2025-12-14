import mongoose from "mongoose";

const fileSchema = new mongoose.Schema({
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "NewPatientPolyclinic",
    required: true,
  },
  fileName: { type: String, required: true, trim: true },
  fileType: {
    type: String,
    enum: ["image", "video", "audio", "pdf", "document", "other"],
    required: true,
    lowercase: true,
  },
  fileUrl: { type: String, required: true },
  fileSize: { type: Number, required: true },
  fileFormat: { type: String, required: true, trim: true },

  uploadedByDoctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  uploadedAt: { type: Date, default: Date.now },

  studyReference: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "studyTypeReference",
    default: null,
  },
  studyTypeReference: {
    type: String,
    enum: [
      "CTScan",
      "MRIScan",
      "USMScan",
      "XRAYScan",
      "PETScan",
      "SPECTScan",
      "GinecologyScan",
      "EEGScan",
      "HOLTERScan",
      "SpirometryScan",
      "DoplerScan",
      "GastroscopyScan",
      "Colonoscopy",
      "CapsuleEndoscopy",
      "AngiographyScan",
      "EKGScan",
      "EchoEKGScan",
      "CoronographyScan",
      "LabTest",
    ],
    required: true,
  },
});

delete mongoose.models.File;
delete mongoose.connection.models["File"];
const File = mongoose.model("File", fileSchema);

export default File;
