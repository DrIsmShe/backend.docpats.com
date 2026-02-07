import mongoose from "mongoose";

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
  { _id: false }
);

const xraySchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      required: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    nameofexamTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "XRayScanTemplateNameofexam",
    },
    reportTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "XRayScanTemplateReport",
    },
    diagnosisTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "XRayScanTemplateDiagnosis",
    },
    recomandationTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "XRayScanTemplateRecomandation",
    },

    date: { type: Date, default: Date.now },

    images: [{ type: String }],
    rawData: { type: String },
    pacsLink: { type: String },
    files: [fileSchema],

    nameofexam: { type: String, trim: true },
    report: { type: String, trim: true },
    recomandation: { type: String, trim: true },
    diagnosis: { type: String, trim: true },

    radiationDose: { type: Number },
    bodyPart: { type: String },

    previousStudy: { type: mongoose.Schema.Types.ObjectId, ref: "XRayScan" },
    relatedStudies: [
      { type: mongoose.Schema.Types.ObjectId, ref: "ImagingStudy" },
    ],

    aiFindings: { type: mongoose.Schema.Types.Mixed },
    aiConfidence: { type: Number, min: 0, max: 1 },
    aiVersion: { type: String },
    aiPrediction: { type: String },
    predictionConfidence: { type: Number, min: 0, max: 1 },
    aiProcessingTime: { type: Number },
    aiProcessedAt: { type: Date },

    validatedByDoctor: { type: Boolean, default: false },
    doctorNotes: { type: String },

    imageQuality: { type: Number, min: 0, max: 100 },
    needsRetake: { type: Boolean, default: false },
    riskLevel: { type: String, enum: ["low", "medium", "high"] },
    riskFactors: [{ type: String }],

    doctorComments: [
      {
        doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: { type: String },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// ✅ защитный экспорт — никакого OverwriteModelError
export default mongoose.models.XRayScan ||
  mongoose.model("XRayScan", xraySchema);
