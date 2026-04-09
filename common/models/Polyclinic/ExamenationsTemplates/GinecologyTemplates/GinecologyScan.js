import mongoose from "mongoose";

// ==========================
// 🔹 Определение схемы для файлов (fileSchema)
// ==========================
const fileSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true },
    fileType: {
      type: String,
      required: true,
      trim: true,
      enum: ["jpg", "jpeg", "png", "webp", "pdf", "doc", "docx", "mp4", "mp3"],
    },
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
      enum: ["GinecologyScan"],
    },
  },
  { _id: false } // отключаем авто-ID для вложенных документов
);

// ==========================
// 🔹 Основная схема гинекологического исследования
// ==========================
const GinecologySchema = new mongoose.Schema(
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

    // 🔸 Ссылки на шаблоны (NameOfExam / Report / Diagnosis / Recommendation)
    nameofexamTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GinecologyTemplateNameofexam",
    },
    reportTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GinecologyTemplateReport",
    },
    diagnosisTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GinecologyTemplateDiagnosis",
    },
    recomandationTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GinecologyTemplateRecomandation",
    },

    date: { type: Date, default: Date.now },

    // 🔸 Файлы, изображения и PACS
    images: [{ type: String, trim: true }],
    rawData: { type: String, trim: true },
    pacsLink: { type: String, trim: true },
    files: [fileSchema],

    // 🔸 Заключение врача
    nameofexam: { type: String, trim: true },
    report: { type: String, trim: true },
    recomandation: { type: String, trim: true },
    diagnosis: { type: String, trim: true },
    radiationDose: { type: Number, min: 0 },
    contrastUsed: { type: Boolean, default: false },

    // 🔸 Ультразвуковые параметры
    dopplerFindings: { type: String, trim: true },
    echogenicity: { type: String, trim: true },
    probeFrequency: { type: Number, min: 0 },

    // 🔸 Связанные исследования
    previousStudy: { type: mongoose.Schema.Types.ObjectId, ref: "Ginecology" },
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
  { timestamps: true }
);

// ==========================
// 🔹 Индексы
// ==========================
GinecologySchema.index({ doctor: 1, patientId: 1, date: -1 });
GinecologySchema.index({
  nameofexam: "text",
  report: "text",
  diagnosis: "text",
});

// ==========================
// ✅ Безопасная регистрация модели
// ==========================
const GinecologyScan =
  mongoose.models.GinecologyScan ||
  mongoose.model("GinecologyScan", GinecologySchema);

export default GinecologyScan;
