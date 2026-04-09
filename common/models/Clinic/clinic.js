// clinic.model.js
// ===================================================================================
// Модель клиники / мед. организации для Docpats
// ===================================================================================

import mongoose from "mongoose";

const { Schema } = mongoose;

/* ======================= Подсхемы ======================= */

// Адрес клиники
const AddressSchema = new Schema(
  {
    country: { type: String, trim: true },
    city: { type: String, trim: true },
    region: { type: String, trim: true },
    street: { type: String, trim: true },
    building: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    geo: {
      lat: { type: Number },
      lng: { type: Number },
    },
  },
  { _id: false },
);

// Контакты клиники
const ContactSchema = new Schema(
  {
    phoneMain: { type: String, trim: true },
    phoneSecondary: { type: String, trim: true },
    email: { type: String, trim: true },
    website: { type: String, trim: true },
    whatsapp: { type: String, trim: true },
    telegram: { type: String, trim: true },
  },
  { _id: false },
);

// Часы работы / расписание
const WorkingHoursSchema = new Schema(
  {
    dayOfWeek: {
      type: String,
      enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      required: true,
    },
    openTime: { type: String }, // "09:00"
    closeTime: { type: String }, // "18:00"
    isClosed: { type: Boolean, default: false },
  },
  { _id: false },
);

// Подразделения / отделения
const DepartmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    floor: { type: String, trim: true },
    headDoctor: {
      type: Schema.Types.ObjectId,
      ref: "User", // doctor / clinic_admin
    },
  },
  { _id: true },
);

// Интеграции с внешними системами (PACS, LIS, billing и т.п.)
const IntegrationSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["pacs", "lis", "emis", "billing", "sms", "email", "other"],
      required: true,
    },
    label: { type: String, trim: true },
    provider: { type: String, trim: true },
    config: { type: Schema.Types.Mixed }, // encrypted config в будущем, если надо
    enabled: { type: Boolean, default: false },
    lastSyncAt: { type: Date, default: null },
  },
  { _id: true },
);

// Биллинг / тарифный план клиники
const BillingPlanSchema = new Schema(
  {
    planCode: {
      type: String,
      enum: ["free", "pro", "clinic", "enterprise"],
      default: "free",
    },
    validUntil: { type: Date, default: null },
    autoRenew: { type: Boolean, default: false },

    maxDoctors: { type: Number, default: 10 },
    maxPatients: { type: Number, default: 5000 },
    maxStorageGb: { type: Number, default: 50 },

    stripeCustomerId: { type: String, trim: true }, // на будущее
    externalBillingId: { type: String, trim: true }, // если будет локальный биллинг
  },
  { _id: false },
);

// Настройки AI для клиники
const AiSettingsSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    allowedFeatures: {
      type: [String],
      default: [],
      // Примеры: "report_summarization", "triage", "followup_suggestions"
    },
    // Какой язык по умолчанию для AI-ответов
    defaultLanguage: {
      type: String,
      enum: ["en", "ru", "az", "tr"],
      default: "en",
    },
    // Правила триажа (future, может быть JSON с протоколами)
    triageRules: { type: Schema.Types.Mixed, default: {} },

    // Набор преднастроенных AI-промптов (для отчётов, рекомендаций и т.д.)
    promptPresets: [
      {
        code: { type: String, trim: true }, // например, "ct_head_report"
        label: { type: String, trim: true },
        description: { type: String, trim: true },
        prompt: { type: String, trim: true },
        enabled: { type: Boolean, default: true },
      },
    ],

    // Пороги риска, при которых AI поднимает флажки
    riskThresholds: {
      critical: { type: Number, default: 0.9 },
      high: { type: Number, default: 0.7 },
      medium: { type: Number, default: 0.5 },
    },
  },
  { _id: false },
);

// Снапшоты аналитики (для дешёвого дешборда)
const AnalyticsSnapshotSchema = new Schema(
  {
    granularity: {
      type: String,
      enum: ["day", "week", "month"],
      required: true,
    },
    date: { type: Date, required: true },
    metrics: {
      totalPatients: { type: Number, default: 0 },
      totalDoctors: { type: Number, default: 0 },
      examsCreated: { type: Number, default: 0 },
      reportsFinalized: { type: Number, default: 0 },
      activeChats: { type: Number, default: 0 },
    },
  },
  { _id: true },
);

// Лог действий (простая аудиторская история для клиники)
const AuditLogSchema = new Schema(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true }, // "doctor.added", "settings.updated" и т.д.
    createdAt: { type: Date, default: Date.now },
    ip: { type: String },
    userAgent: { type: String },
    meta: { type: Schema.Types.Mixed },
  },
  { _id: true },
);

/* ======================= Основная схема Clinic ======================= */

const ClinicSchema = new Schema(
  {
    // Базовая информация
    name: { type: String, required: true, trim: true },
    legalName: { type: String, trim: true }, // юридическое название (если отличается)
    slug: { type: String, trim: true, index: true, unique: true, sparse: true },

    logoUrl: { type: String, trim: true },
    coverImageUrl: { type: String, trim: true },

    description: { type: String, trim: true, maxlength: 4000 },

    address: { type: AddressSchema, default: () => ({}) },
    contacts: { type: ContactSchema, default: () => ({}) },
    workingHours: { type: [WorkingHoursSchema], default: [] },

    // Владелец / главный админ (clinic_admin)
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Статус клиники в системе Docpats
    status: {
      type: String,
      enum: ["pending", "active", "suspended", "archived"],
      default: "pending",
      index: true,
    },

    // Тип организации (на будущее, можно использовать не только клинику)
    orgType: {
      type: String,
      enum: ["clinic", "hospital", "lab", "diagnostic_center", "other"],
      default: "clinic",
    },

    // Связи с пользователями (быстрые списки, а не единственный источник истины)
    doctorIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    staffIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    // Пациенты клиники (через доктора/отчёты, но можно кешировать)
    patientIds: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // Отделения / департаменты
    departments: { type: [DepartmentSchema], default: [] },

    // Интеграции с внешними системами
    integrations: { type: [IntegrationSchema], default: [] },

    // Биллинг / тариф
    billing: { type: BillingPlanSchema, default: () => ({}) },

    // Настройки AI
    aiSettings: { type: AiSettingsSchema, default: () => ({}) },

    // AI-аналитика / инсайты по клинике (краткие summary, обновляемые cron’ом)
    aiInsights: [
      {
        createdAt: { type: Date, default: Date.now },
        kind: {
          type: String,
          enum: ["operations", "quality", "load", "risk"],
        },
        summary: { type: String, maxlength: 8000 },
        // Для удобства можно хранить сырые метрики/результаты
        data: { type: Schema.Types.Mixed },
        generatedBy: { type: String, default: "system" }, // модель / версия
      },
    ],

    // Снапшоты аналитики (для дешёвых графиков без тяжёлых агрегатов)
    analyticsSnapshots: { type: [AnalyticsSnapshotSchema], default: [] },

    // Настройки видимости
    isPublicProfile: { type: Boolean, default: false },
    publicProfileSlug: { type: String, trim: true }, // если будет "страница клиники" для пациентов

    // Связь с другими сущностями системы
    // (могут быть не обязательными, часть будет использоваться позже)
    defaultChatId: {
      type: Schema.Types.ObjectId,
      ref: "Chat",
      default: null,
    }, // общий чат клиники (регистратура)
    filesRootFolderId: {
      type: Schema.Types.ObjectId,
      ref: "File",
      default: null,
    }, // корневая папка в файловой системе

    // Настройки уведомлений
    notificationSettings: {
      systemEmails: { type: Boolean, default: true },
      systemSms: { type: Boolean, default: false },
      aiReports: { type: Boolean, default: false },
    },

    // Журналы
    auditLog: { type: [AuditLogSchema], default: [] },

    // Флаги / фичи для экспериментов
    featureFlags: { type: Map, of: Boolean, default: {} },

    // Квоты (ограничения для клиники)
    quotas: {
      maxDoctors: { type: Number, default: 50 },
      maxStaff: { type: Number, default: 200 },
      maxPatients: { type: Number, default: 50_000 },
      maxStorageGb: { type: Number, default: 200 },
    },

    // Мягкое удаление
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

/* ======================= Индексы ======================= */

ClinicSchema.index({ name: 1 });
ClinicSchema.index({ "address.country": 1, "address.city": 1 });
ClinicSchema.index({ ownerUserId: 1, status: 1 });
ClinicSchema.index({ orgType: 1, status: 1 });

/* ======================= Сериализация ======================= */

ClinicSchema.set("toJSON", {
  virtuals: true,
  transform: (_, ret) => {
    // Можно скрыть внутренние поля при выдаче наружу
    if (ret.auditLog) {
      ret.auditLog = ret.auditLog.slice(-50); // например, не отдавать всю историю
    }
    return ret;
  },
});

ClinicSchema.set("toObject", { virtuals: true });

/* ======================= Экспорт ======================= */

const Clinic = mongoose.model("Clinic", ClinicSchema);
export default Clinic;
