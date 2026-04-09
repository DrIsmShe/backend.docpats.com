import mongoose from "mongoose";

const fileSchema = new mongoose.Schema(
  {
    /**
     * 🧑‍⚕️ REGISTERED PATIENT (Mongo ObjectId)
     */
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      required: false,
      index: true,
    },

    /**
     * 🧑‍⚕️ PRIVATE PATIENT (string / custom id)
     */
    patientId: {
      type: String,
      required: false,
      index: true,
    },

    /**
     * 📎 FILE INFO
     */
    fileName: {
      type: String,
      required: true,
      trim: true,
    },

    fileType: {
      type: String,
      enum: ["image", "video", "audio", "pdf", "document", "other"],
      required: true,
      lowercase: true,
    },

    fileUrl: {
      type: String,
      required: true,
    },

    fileSize: {
      type: Number,
      required: true,
    },

    fileFormat: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * 👨‍⚕️ UPLOADED BY
     */
    uploadedByDoctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    uploadedAt: {
      type: Date,
      default: Date.now,
    },

    /**
     * 🧪 STUDY REFERENCE
     */
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
  },
  {
    timestamps: true,
  },
);

/**
 * 🛡️ SAFETY VALIDATION
 * Either patient OR patientId must exist
 */
fileSchema.pre("validate", function (next) {
  if (!this.studyTypeReference) {
    return next(new Error("File must be linked to a study"));
  }
  next();
});

/**
 * 🔄 HOT-RELOAD SAFE
 */
delete mongoose.models.File;
delete mongoose.connection.models["File"];

const File = mongoose.model("File", fileSchema);
export default File;
