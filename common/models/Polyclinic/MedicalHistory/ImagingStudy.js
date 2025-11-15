import mongoose from "mongoose";
import File from "../../file.js"; // ✅ добавлен импорт для fileSchema

// 🔹 Извлекаем схему файла из модели File
const fileSchema = File.schema;

// 🔹 Основная схема медицинских исследований (КТ, МРТ, УЗИ и т.д.)
const imagingStudySchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      required: true,
    },

    studyType: {
      type: String,
      enum: [
        "CT",
        "MRI",
        "USG",
        "X-Ray",
        "PET",
        "SPECT",
        "EEG",
        "ECG",
        "Holter",
        "Spirometry",
        "Doppler",
        "Gastroscopy",
        "Colonoscopy",
        "CapsuleEndoscopy",
      ],
      required: true,
    },

    studyReference: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "studyTypeReference",
    },

    studyTypeReference: {
      type: String,
      required: true,
      enum: [
        "CTScan",
        "MRIScan",
        "Ultrasound",
        "XRay",
        "PETScan",
        "SPECTScan",
        "EEG",
        "ECG",
        "HolterMonitor",
        "Spirometry",
        "DopplerScan",
        "Gastroscopy",
        "Colonoscopy",
        "CapsuleEndoscopy",
      ],
    },

    date: { type: Date, default: Date.now },

    images: [{ type: String }], // Ссылки на изображения
    rawData: { type: String }, // DICOM-файл или архив
    pacsLink: { type: String }, // Ссылка на PACS/DICOM

    report: { type: String }, // Заключение врача
    diagnosis: { type: String }, // Диагноз
    contrastUsed: { type: Boolean, default: false }, // Использовался ли контраст

    previousStudy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ImagingStudy",
    }, // Предыдущее исследование
    relatedStudies: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ImagingStudy",
      },
    ], // Связанные исследования

    // 🧠 Данные ИИ
    aiFindings: { type: mongoose.Schema.Types.Mixed }, // Результаты анализа
    aiConfidence: { type: Number, min: 0, max: 1 },
    aiVersion: { type: String },
    aiPrediction: { type: String },
    predictionConfidence: { type: Number, min: 0, max: 1 },
    aiProcessingTime: { type: Number },
    aiProcessedAt: { type: Date },

    // 👨‍⚕️ Подтверждение врача
    validatedByDoctor: { type: Boolean, default: false },
    doctorNotes: { type: String },

    // 📎 Поддержка файлов
    files: [fileSchema],

    // 🔧 Дополнительные данные
    threeDModel: { type: String },
    imageQuality: { type: Number, min: 0, max: 100 },
    needsRetake: { type: Boolean, default: false },
    riskLevel: { type: String, enum: ["low", "medium", "high"] },
    riskFactors: [{ type: String }],

    // 💬 Комментарии врачей
    doctorComments: [
      {
        doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: { type: String },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// 🔹 Индексы для оптимизации поиска
imagingStudySchema.index({ patient: 1, studyType: 1, date: -1 });
imagingStudySchema.index({ aiPrediction: "text", diagnosis: "text" });

// 🔹 Безопасная регистрация модели (исключает "Cannot overwrite model")
const ImagingStudy =
  mongoose.models.ImagingStudy ||
  mongoose.model("ImagingStudy", imagingStudySchema);

export default ImagingStudy;
