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

// Основная схема CT-скана
const doplerSchema = new mongoose.Schema(
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
      ref: "DoplerScanTemplateNameofexam",
    },
    reportTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoplerScannTemplateReport",
    },
    diagnosisTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoplerScanTemplateDiagnosis",
    },
    recomandationTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoplerScanTemplateRecomandation",
    },
    date: { type: Date, default: Date.now },

    // Файлы КТ (снимки, DICOM, PACS)
    images: [{ type: String, trim: true }], // Ссылки на снимки
    rawData: { type: String, trim: true }, // DICOM-файл
    pacsLink: { type: String, trim: true }, // Ссылка на PACS-хранилище
    files: [fileSchema], // Поддержка файлов

    // Заключение врача
    nameofexam: { type: String, trim: true },
    report: { type: String, trim: true },
    recomandation: { type: String, trim: true },
    diagnosis: { type: String, trim: true },
    radiationDose: { type: Number, min: 0 }, // Доза радиации (мЗв)
    contrastUsed: { type: Boolean, default: false }, // Использовался ли контраст?

    // Связанные исследования
    previousStudy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoplerScan",
    }, // Предыдущие КТ пациента
    relatedStudies: [
      { type: mongoose.Schema.Types.ObjectId, ref: "ImagingStudy" },
    ], // Связанные исследования

    // Данные ИИ
    aiFindings: { type: mongoose.Schema.Types.Mixed }, // Анализ ИИ (опухоли, патологии)
    aiConfidence: { type: Number, min: 0, max: 1 }, // Доверие модели
    aiVersion: { type: String, trim: true }, // Версия модели
    aiPrediction: { type: String, trim: true }, // Предсказанный диагноз
    predictionConfidence: { type: Number, min: 0, max: 1 }, // Доверие к предсказанию
    aiProcessingTime: { type: Number, min: 0 }, // Время обработки в секундах
    aiProcessedAt: { type: Date }, // Когда обработано ИИ

    // Вердикт врача
    validatedByDoctor: { type: Boolean, default: false },
    doctorNotes: { type: String, trim: true },

    // Дополнительные данные
    threeDModel: { type: String, trim: true }, // Ссылка на 3D-модель
    imageQuality: { type: Number, min: 0, max: 100 }, // Качество снимка
    needsRetake: { type: Boolean, default: false }, // Нужно ли переделать снимок?
    riskLevel: { type: String, enum: ["low", "medium", "high"], trim: true }, // Уровень риска
    riskFactors: [{ type: String, trim: true }], // Факторы риска пациента

    // Комментарии врача
    doctorComments: [
      {
        doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: { type: String, trim: true },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
); // Автоматическое добавление `createdAt` и `updatedAt`

// Создаем модель DoplerScan
const DoplerScan = mongoose.model("DoplerScan", doplerSchema);

export default DoplerScan;
