import mongoose from "mongoose";

/* =====================================================
   📎 File Schema
===================================================== */
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

    studyTypeReference: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false },
);

/* =====================================================
   🔥 USM (Ultrasound) Schema
===================================================== */
const usmSchema = new mongoose.Schema(
  {
    /* ===============================
       👤 Patient (универсальный)
    =============================== */

    // legacy поле (оставляем для совместимости)
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
    // основное поле
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

    /* ===============================
       👨‍⚕️ Doctor
    =============================== */
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* ===============================
       📄 Templates
    =============================== */
    nameofexamTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "USMScanTemplateNameofexam",
    },

    reportTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "USMScanTemplateReport",
    },

    diagnosisTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "USMScanTemplateDiagnosis",
    },

    recomandationTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "USMScanTemplateRecomandation",
    },

    /* ===============================
       📅 Date
    =============================== */
    date: {
      type: Date,
      default: Date.now,
    },

    /* ===============================
       📎 Files & Media
    =============================== */
    images: [{ type: String, trim: true }],
    rawData: { type: String, trim: true },
    pacsLink: { type: String, trim: true },
    files: [fileSchema],

    /* ===============================
       🩺 Medical Content
    =============================== */
    nameofexam: { type: String, trim: true },
    report: { type: String, trim: true },
    diagnosis: { type: String, trim: true },
    recomandation: { type: String, trim: true },

    bodyPart: { type: String, trim: true },

    /* ===============================
       🔗 Study Relations
    =============================== */

    previousStudy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "USMScan", // 🔥 исправлено (было XRayScan)
    },

    relatedStudies: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ImagingStudy",
      },
    ],

    /* ===============================
       🤖 AI Section
    =============================== */

    aiFindings: { type: mongoose.Schema.Types.Mixed },

    aiConfidence: {
      type: Number,
      min: 0,
      max: 1,
    },

    aiVersion: { type: String, trim: true },

    aiPrediction: { type: String, trim: true },

    predictionConfidence: {
      type: Number,
      min: 0,
      max: 1,
    },

    aiProcessingTime: {
      type: Number,
      min: 0,
    },

    aiProcessedAt: { type: Date },

    /* ===============================
       👨‍⚕️ Validation
    =============================== */

    validatedByDoctor: {
      type: Boolean,
      default: false,
    },

    doctorNotes: {
      type: String,
      trim: true,
    },

    /* ===============================
       📊 Quality & Risk
    =============================== */

    imageQuality: {
      type: Number,
      min: 0,
      max: 100,
    },

    needsRetake: {
      type: Boolean,
      default: false,
    },

    riskLevel: {
      type: String,
      enum: ["low", "medium", "high"],
    },

    riskFactors: [{ type: String, trim: true }],

    /* ===============================
       💬 Doctor Comments
    =============================== */

    doctorComments: [
      {
        doctor: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        text: {
          type: String,
          trim: true,
        },
      },
    ],
  },
  {
    timestamps: true,
  },
);

/* =====================================================
   ✅ Safe Export (No OverwriteModelError)
===================================================== */

export default mongoose.models.USMScan || mongoose.model("USMScan", usmSchema);
