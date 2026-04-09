import mongoose from "mongoose";

// ==========================
// 🔹 Определение схемы для файлов (fileSchema)
// ==========================
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
  { _id: false }, // без собственного _id для вложенных документов
);

// ==========================
// 🔹 Основная схема КТ-исследования
// ==========================
const ctSchema = new mongoose.Schema(
  {
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
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // 🔸 Ссылки на шаблоны (NameOfExam / Report / Diagnosis / Recommendation)
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

    // 🔸 Файлы КТ (снимки, DICOM, PACS)
    images: [{ type: String, trim: true }], // Ссылки на снимки
    rawData: { type: String, trim: true }, // DICOM-файл
    pacsLink: { type: String, trim: true }, // Ссылка на PACS
    files: [fileSchema], // Поддержка файлов

    // 🔸 Заключения врача
    nameofexam: { type: String, trim: true },
    report: { type: String, trim: true },
    recomandation: { type: String, trim: true },
    diagnosis: { type: String, trim: true },

    radiationDose: { type: Number, min: 0 }, // Доза радиации
    contrastUsed: { type: Boolean, default: false },

    // 🔸 Связанные исследования
    previousStudy: { type: mongoose.Schema.Types.ObjectId, ref: "USMScan" },
    relatedStudies: [
      { type: mongoose.Schema.Types.ObjectId, ref: "ImagingStudy" },
    ],

    // 🔸 Данные ИИ
    aiFindings: { type: mongoose.Schema.Types.Mixed },
    aiConfidence: { type: Number, min: 0, max: 1 },
    aiVersion: { type: String, trim: true },
    aiPrediction: { type: String, trim: true },
    predictionConfidence: { type: Number, min: 0, max: 1 },
    aiProcessingTime: { type: Number, min: 0 },
    aiProcessedAt: { type: Date },

    // 🔸 Вердикт врача
    validatedByDoctor: { type: Boolean, default: false },
    doctorNotes: { type: String, trim: true },

    // 🔸 Дополнительные данные
    threeDModel: { type: String, trim: true },
    imageQuality: { type: Number, min: 0, max: 100 },
    needsRetake: { type: Boolean, default: false },
    riskLevel: { type: String, enum: ["low", "medium", "high"], trim: true },
    riskFactors: [{ type: String, trim: true }],

    // 🔸 Комментарии врача
    doctorComments: [
      {
        doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: { type: String, trim: true },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }, // Автоматическое createdAt и updatedAt
);

// ==========================
// 🔹 Индексы для оптимизации
// ==========================
ctSchema.index({ doctor: 1, patientId: 1, date: -1 });
ctSchema.index({ nameofexam: "text", report: "text", diagnosis: "text" });

// ==========================
// ✅ Безопасная регистрация модели
// ==========================
const CTScan = mongoose.models.CTScan || mongoose.model("CTScan", ctSchema);

export default CTScan;
