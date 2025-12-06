import mongoose from "mongoose";

// ===== File subdocument =====
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
  { _id: false } // не создаём _id для вложенных документов
);

// ===== SPECTScan schema =====
const spectSchema = new mongoose.Schema(
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
      ref: "SPECTScanTemplateNameofexam",
    },
    reportTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SPECTScanTemplateReport",
    },
    diagnosisTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SPECTScanTemplateDiagnosis",
    },
    recomandationTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SPECTScanTemplateRecomandation",
    },

    date: { type: Date, default: Date.now },

    // Медиа/файлы
    images: [{ type: String }],
    rawData: { type: String },
    pacsLink: { type: String },
    files: [fileSchema],

    // Заключение
    nameofexam: { type: String, trim: true },
    report: { type: String, trim: true },
    recomandation: { type: String, trim: true },
    diagnosis: { type: String, trim: true },

    // Параметры исследования
    radiationDose: { type: Number },
    bodyPart: { type: String },

    // Связанные исследования
    previousStudy: { type: mongoose.Schema.Types.ObjectId, ref: "SPECTScan" },
    relatedStudies: [
      { type: mongoose.Schema.Types.ObjectId, ref: "ImagingStudy" },
    ],

    // Данные ИИ
    aiFindings: { type: mongoose.Schema.Types.Mixed },
    aiConfidence: { type: Number, min: 0, max: 1 },
    aiVersion: { type: String },
    aiPrediction: { type: String },
    predictionConfidence: { type: Number, min: 0, max: 1 },
    aiProcessingTime: { type: Number },
    aiProcessedAt: { type: Date },

    // Верификация/заметки
    validatedByDoctor: { type: Boolean, default: false },
    doctorNotes: { type: String },

    // Доп. данные
    imageQuality: { type: Number, min: 0, max: 100 },
    needsRetake: { type: Boolean, default: false },
    riskLevel: { type: String, enum: ["low", "medium", "high"] },
    riskFactors: [{ type: String }],

    // Комментарии врача
    doctorComments: [
      {
        doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: { type: String },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true } // добавляет createdAt/updatedAt
);

// ===== Model (guarded) =====
const SPECTScan =
  mongoose.models.SPECTScan || mongoose.model("SPECTScan", spectSchema);

export default SPECTScan;
