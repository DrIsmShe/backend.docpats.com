import mongoose from "mongoose";

// Определение схемы для файлов (fileSchema)
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
); // Отключаем автоматическое создание `_id` для вложенных документов

const petSchema = new mongoose.Schema({
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
    ref: "PETScanTemplateNameofexam",
  },
  reportTemplate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "PETScanTemplateReport",
  },
  diagnosisTemplate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "PETScanTemplateDiagnosis",
  },
  recomandationTemplate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "PETScanTemplateRecomandation",
  },
  date: { type: Date, default: Date.now },
  images: [{ type: String }], // Снимки
  rawData: { type: String }, // DICOM-файл
  pacsLink: { type: String }, // Ссылка на PACS/DICOM-архив
  nameofexam: { type: String, trim: true },
  report: { type: String, trim: true },
  recomandation: { type: String, trim: true },
  diagnosis: { type: String, trim: true },
  radiationDose: { type: Number }, // Доза облучения (мЗв)
  bodyPart: { type: String }, // Часть тела (например, "грудная клетка", "позвоночник")
  previousStudy: { type: mongoose.Schema.Types.ObjectId, ref: "PETScan" }, // Предыдущее рентген-исследование
  relatedStudies: [
    { type: mongoose.Schema.Types.ObjectId, ref: "ImagingStudy" },
  ], // Связанные исследования
  files: [fileSchema], // Поддержка файлов
  // Данные ИИ
  aiFindings: { type: mongoose.Schema.Types.Mixed },
  aiConfidence: { type: Number, min: 0, max: 1 },
  aiVersion: { type: String },
  aiPrediction: { type: String },
  predictionConfidence: { type: Number, min: 0, max: 1 },
  aiProcessingTime: { type: Number },
  aiProcessedAt: { type: Date },

  // Вердикт врача
  validatedByDoctor: { type: Boolean, default: false },
  doctorNotes: { type: String },

  // Дополнительные данные
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
});
const PETScan = mongoose.model("PETScan", petSchema);

export default PETScan;
