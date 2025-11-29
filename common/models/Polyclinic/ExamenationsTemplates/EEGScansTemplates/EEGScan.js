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

const eegSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      required: true,
    },
    date: { type: Date, default: Date.now },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    nameofexamTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EEGScanTemplateNameofexam",
    },
    reportTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EEGScanTemplateReport",
    },
    diagnosisTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EEGScanTemplateDiagnosis",
    },
    recomandationTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EEGScanTemplateRecomandation",
    },
    images: [{ type: String }], // Снимки
    rawData: { type: String }, // DICOM-файл
    pacsLink: { type: String }, // Ссылка на PACS/DICOM-архив
    nameofexam: { type: String, trim: true },
    report: { type: String, trim: true },
    recomandation: { type: String, trim: true },
    diagnosis: { type: String, trim: true },
    electrodePlacement: { type: String },
    signalDuration: { type: Number },
    eventMarkers: [{ type: String }],
    brainRegions: [{ type: String }],
    previousEEG: { type: mongoose.Schema.Types.ObjectId, ref: "EEGScan" },
    files: [fileSchema], // Поддержка файлов
    aiFindings: { type: mongoose.Schema.Types.Mixed },
    aiConfidence: { type: Number, min: 0, max: 1 },
    aiVersion: { type: String },

    validatedByDoctor: { type: Boolean, default: false },
    doctorNotes: { type: String },
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

const EEGScan = mongoose.model("EEGScan", eegSchema);

export default EEGScan;
