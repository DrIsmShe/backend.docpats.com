import mongoose from "mongoose";

/* ===============================
   📎 File Schema
=============================== */
const fileSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true },
    fileType: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true },
    fileSize: { type: Number, required: true },
    fileFormat: { type: String, required: true, trim: true },
    studyReference: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Study",
      default: null,
    },
    studyTypeReference: { type: String, required: true, trim: true },
  },
  { _id: false },
);

/* ===============================
   🫀 EKG Schema
=============================== */
const ekgSchema = new mongoose.Schema(
  {
    // legacy
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
    },
    performedOutsideSpecialization: {
      type: Boolean,
      default: false,
    },
    doctorSpecializationAtCreation: {
      type: String,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      refPath: "patientModel",
    },

    patientModel: {
      type: String,
      required: true,
      enum: ["NewPatientPolyclinic", "DoctorPrivatePatient"],
    },

    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    nameofexamTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EKGScanTemplateNameofexam",
    },

    reportTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EKGScanTemplateReport",
    },

    diagnosisTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EKGScanTemplateDiagnosis",
    },

    recomandationTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EKGScanTemplateRecomandation",
    },

    date: {
      type: Date,
      default: Date.now,
    },

    files: [fileSchema],

    nameofexam: { type: String, trim: true },
    report: { type: String, trim: true },
    diagnosis: { type: String, trim: true },
    recomandation: { type: String, trim: true },

    /* ===============================
       🫀 Специфические параметры EKG
    =============================== */

    monitoringDuration: { type: Number }, // минуты
    maxHeartRate: { type: Number },
    minHeartRate: { type: Number },
    averageHeartRate: { type: Number },
    arrhythmiaEpisodes: [{ type: String, trim: true }],

    /* ===============================
       🤖 AI
    =============================== */

    aiFindings: { type: mongoose.Schema.Types.Mixed },
    aiConfidence: { type: Number, min: 0, max: 1 },
    aiVersion: { type: String, trim: true },
    aiPrediction: { type: String, trim: true },
    predictionConfidence: { type: Number, min: 0, max: 1 },
    aiProcessingTime: { type: Number, min: 0 },
    aiProcessedAt: { type: Date },

    validatedByDoctor: { type: Boolean, default: false },
    doctorNotes: { type: String, trim: true },

    doctorComments: [
      {
        doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: { type: String, trim: true },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

export default mongoose.models.EKGScan || mongoose.model("EKGScan", ekgSchema);
