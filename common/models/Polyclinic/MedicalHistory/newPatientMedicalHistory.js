import mongoose from "mongoose";

// Определение схемы для хранения информации о пациенте в поликлинике
const newPatientMedicalHistorySchema = new mongoose.Schema(
  {
    // Пациент, к которому относится история болезни (ОДИН пациент)
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      required: true, // Пациент обязателен
    },
    // Врач, создавший запись (Автор истории болезни)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // metaDescription слова для SEO
    metaDescription: { type: [String], default: [] },
    // Ключевые слова для SEO
    metaKeywords: { type: [String], default: [] },
    // Статус публикации
    isPublished: { type: Boolean, default: false },
    // Ссылка на лечащего врача
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Ссылка на лечащего врача
    doctorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorProfile",
    },
    // Количество просмотров профиля пациента
    views: { type: Number, default: 0 },
    // Примерное время чтения данных о пациенте
    readTime: { type: Number, default: 0 },
    // Жалобы пациента
    complaints: { type: String, trim: true },
    // Анамнез болезни
    anamnesisMorbi: { type: String, trim: true },
    // Анамнез жизни
    anamnesisVitae: { type: String, trim: true },
    // Общий статус пациента
    statusPreasens: { type: String, trim: true },
    // Локальный статус пациента
    statusLocalis: { type: String, trim: true },
    // Рекомендации врача
    recommendations: { type: String, trim: true },
    // Результаты КТ-сканирования
    ctScanResults: { type: String, trim: true },
    // Результаты МРТ
    mriResults: { type: String, trim: true },
    // Результаты УЗИ
    ultrasoundResults: { type: String, trim: true },
    // Результаты лабораторных исследований
    laboratoryTestResults: { type: String, trim: true },
    // Связанные диагнозы
    diagnosis: { type: String, trim: true, required: true },
    //дополнительный уточняющий диагноз
    additionalDiagnosis: { type: String, trim: true },
    // Файлы пациента
    files: [{ type: mongoose.Schema.Types.ObjectId, ref: "File", default: [] }],
    // История посещений пациента
    history: [
      {
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        updatedAt: { type: Date, default: Date.now },
        changes: {
          field: String,
          oldValue: mongoose.Schema.Types.Mixed,
          newValue: mongoose.Schema.Types.Mixed,
        },
      },
    ],
    // Документы пациента
    documents: [
      {
        name: { type: String, trim: true },
        url: { type: String, trim: true },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    // Согласие на обработку данных
    isConsentGiven: { type: Boolean, default: false },
    // Аллергический статус
    allergies: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "allergiesPatient",
      },
    ],
    // Наследственные заболевания
    familyHistoryOfDisease: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "familyHistoryOfDiseasePatient",
      },
    ],
    // Перенесенные операции
    operations: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "operationsPatient",
      },
    ],
    // Хронические заболевания
    chronicDiseases: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "chronicDiseasesPatient",
      },
    ],
    // Хронические заболевания
    immunization: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "immunizationPatient",
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Индексы для быстрого поиска по имени и телефону
newPatientMedicalHistorySchema.index({ fullName: "text", phone: 1 });

// Создаем и экспортируем модель
const newPatientMedicalHistoryModel = mongoose.model(
  "newPatientMedicalHistory",
  newPatientMedicalHistorySchema
);

export default newPatientMedicalHistoryModel;
