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
      ref: "Study",
      default: null,
    },
    studyTypeReference: { type: String, required: true, trim: true },
  },
  { _id: false } // не создаём _id для вложенных документов
);

/* ===================== CTScan schema ===================== */
const ctSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    nameofexamTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CTScanTemplateNameofexam",
    },
    reportTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CTScanTemplateReport",
    },
    diagnosisTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CTScanTemplateDiagnosis",
    },
    recomandationTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CTScanTemplateRecomandation",
    },

    date: { type: Date, default: Date.now },

    // Медиа/файлы
    images: [{ type: String, trim: true }],
    rawData: { type: String, trim: true },
    pacsLink: { type: String, trim: true },
    files: [fileSchema],

    // Заключение
    nameofexam: { type: String, trim: true },
    report: { type: String, trim: true },
    recomandation: { type: String, trim: true },
    diagnosis: { type: String, trim: true },
    radiationDose: { type: Number, min: 0 },
    contrastUsed: { type: Boolean, default: false },

    // Связанные исследования
    previousStudy: { type: mongoose.Schema.Types.ObjectId, ref: "USMScan" },
    relatedStudies: [
      { type: mongoose.Schema.Types.ObjectId, ref: "ImagingStudy" },
    ],

    // AI
    aiFindings: { type: mongoose.Schema.Types.Mixed },
    aiConfidence: { type: Number, min: 0, max: 1 },
    aiVersion: { type: String, trim: true },
    aiPrediction: { type: String, trim: true },
    predictionConfidence: { type: Number, min: 0, max: 1 },
    aiProcessingTime: { type: Number, min: 0 },
    aiProcessedAt: { type: Date },

    // Валидация/заметки
    validatedByDoctor: { type: Boolean, default: false },
    doctorNotes: { type: String, trim: true },

    // Доп. поля
    threeDModel: { type: String, trim: true },
    imageQuality: { type: Number, min: 0, max: 100 },
    needsRetake: { type: Boolean, default: false },
    riskLevel: { type: String, enum: ["low", "medium", "high"], trim: true },
    riskFactors: [{ type: String, trim: true }],

    // Комментарии
    doctorComments: [
      {
        doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: { type: String, trim: true },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

/* ===================== Model (guarded) ===================== */
// Защита от переобъявления модели при hot-reload / повторных импортах
const CTScan = mongoose.models.CTScan || mongoose.model("CTScan", ctSchema);

export default CTScan;
