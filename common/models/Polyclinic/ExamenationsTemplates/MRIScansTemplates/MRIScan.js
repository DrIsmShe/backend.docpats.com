import mongoose from "mongoose";

/* ===================== File subdocument ===================== */
const fileSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true },
    fileType: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true },
    fileSize: { type: Number, required: true },
    fileFormat: { type: String, required: true, trim: true },
    studyReference: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MRIScan",
      default: null,
    },
    studyTypeReference: { type: String, required: true, trim: true },
  },
  { _id: false },
);

/* ===================== MRIScan schema ===================== */
const mriSchema = new mongoose.Schema(
  {
    /* 🔥 Legacy (не использовать в новом коде) */
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
    /* 🔥 Универсальный пациент */
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
    },

    /* 📄 Templates (если используешь шаблоны) */
    nameofexamTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MRIScanTemplateNameofexam",
    },
    reportTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MRIScanTemplateReport",
    },
    diagnosisTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MRIScanTemplateDiagnosis",
    },
    recomandationTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MRIScanTemplateRecomandation",
    },

    date: { type: Date, default: Date.now },

    /* 📎 FILES (вложенные) */
    images: [{ type: String, trim: true }],
    rawData: { type: String, trim: true },
    pacsLink: { type: String, trim: true },
    files: [fileSchema],

    /* 📝 REPORT DATA */
    nameofexam: { type: String, trim: true },
    report: { type: String, trim: true },
    recomandation: { type: String, trim: true },
    diagnosis: { type: String, trim: true },

    radiationDose: { type: Number, min: 0 },
    contrastUsed: { type: Boolean, default: false },

    /* 🔬 MRI SPECIFIC */
    magneticFieldStrength: { type: Number },
    sequenceTypes: [{ type: String, trim: true }],
    sliceThickness: { type: Number },

    /* 🔗 RELATED STUDIES */
    previousStudy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MRIScan",
    },

    relatedStudies: [
      { type: mongoose.Schema.Types.ObjectId, ref: "ImagingStudy" },
    ],

    /* 🤖 AI BLOCK */
    aiFindings: { type: mongoose.Schema.Types.Mixed },
    aiConfidence: { type: Number, min: 0, max: 1 },
    aiVersion: { type: String, trim: true },
    aiPrediction: { type: String, trim: true },
    predictionConfidence: { type: Number, min: 0, max: 1 },
    aiProcessingTime: { type: Number, min: 0 },
    aiProcessedAt: { type: Date },

    /* 👨‍⚕️ VALIDATION */
    validatedByDoctor: { type: Boolean, default: false },
    doctorNotes: { type: String, trim: true },

    /* 📊 ADDITIONAL */
    threeDModel: { type: String, trim: true },
    imageQuality: { type: Number, min: 0, max: 100 },
    needsRetake: { type: Boolean, default: false },
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      trim: true,
    },
    riskFactors: [{ type: String, trim: true }],

    /* 💬 COMMENTS */
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

/* ===================== Safe Model ===================== */

const MRIScan = mongoose.models.MRIScan || mongoose.model("MRIScan", mriSchema);

export default MRIScan;
