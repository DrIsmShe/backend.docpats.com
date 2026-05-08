import mongoose from "mongoose";

// Определение схемы для хранения информации о пациенте в поликлинике
const newPatientMedicalHistorySchema = new mongoose.Schema(
  {
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
    // Профиль лечащего врача
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

    // ─────────────────────────────────────────────
    // ОСНОВНОЙ ДИАГНОЗ ПО МКБ-10
    // code      — код МКБ (например "J45.1") для аналитики/статистики
    // codeTitle — официальное англ. название из NLM (на момент выбора)
    // text      — диагноз на родном языке врача (свободно редактируется)
    // ─────────────────────────────────────────────
    mainDiagnosis: {
      code: { type: String, trim: true, default: "" },
      codeTitle: { type: String, trim: true, default: "" },
      text: { type: String, trim: true, default: "" },
    },

    // Старое поле — оставлено для обратной совместимости со старыми записями.
    // Новые записи его не используют. Можно удалить после полной миграции.
    diagnosis: { type: String, trim: true },

    // Дополнительный уточняющий диагноз — без изменений
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
    patientType: {
      type: String,
      enum: ["registered", "private"],
      required: true,
      index: true,
    },
    patientRef: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "patientTypeModel",
    },
    patientTypeModel: {
      type: String,
      required: true,
      enum: ["DoctorPrivatePatient", "NewPatientPolyclinic"],
    },
    // Прививочный статус
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
  },
);

// ─────────────────────────────────────────────
// ИНДЕКСЫ
// ─────────────────────────────────────────────

// Существующий составной индекс — не трогаем
newPatientMedicalHistorySchema.index({
  patientType: 1,
  patientRef: 1,
});

// Новый индекс для аналитики по МКБ-кодам
// (быстрая выборка "все пациенты с диагнозом J45.*", статистика и т.д.)
newPatientMedicalHistorySchema.index({ "mainDiagnosis.code": 1 });

// ─────────────────────────────────────────────
// ВАЛИДАЦИЯ ОСНОВНОГО ДИАГНОЗА
// Применяется только к новым записям, чтобы не сломать существующие
// (у которых mainDiagnosis ещё не заполнен — есть только старое поле diagnosis).
// ─────────────────────────────────────────────
newPatientMedicalHistorySchema.pre("validate", function (next) {
  if (this.isNew) {
    const md = this.mainDiagnosis;
    if (!md || !md.code?.trim() || !md.text?.trim()) {
      return next(
        new Error(
          "Main diagnosis is required: ICD-10 code and diagnosis text must be filled.",
        ),
      );
    }
  }
  next();
});

// Создаем и экспортируем модель
const newPatientMedicalHistoryModel = mongoose.model(
  "newPatientMedicalHistory",
  newPatientMedicalHistorySchema,
);

export default newPatientMedicalHistoryModel;
