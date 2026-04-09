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
  { _id: false },
); // Отключаем автоматическое создание `_id` для вложенных документов

const eegSchema = new mongoose.Schema(
  {
    // 🔥 legacy-Поле — можно оставить для старых записей, но НЕ использовать в новом коде
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
    // 🔥 единое поле пациента (и для зарегистрированных, и для приватных)
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      refPath: "patientModel",
    },

    // 🔥 указывает, с какой моделью связан patient
    patientModel: {
      type: String,
      required: true,
      enum: ["NewPatientPolyclinic", "DoctorPrivatePatient"],
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
  { timestamps: true },
);

const EEGScan = mongoose.models.EEGScan || mongoose.model("EEGScan", eegSchema);

export default EEGScan;
