import mongoose from "mongoose";

const PatientRiskEntrySchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, required: true },
    patientName: { type: String, default: "" },

    // Из fullRiskAssessment — топ домен
    topRiskDomain: { type: String, default: "" },
    topRiskLevel: {
      type: String,
      enum: ["low", "moderate", "high"],
      default: "low",
    },
    topRiskReason: { type: String, default: "" },

    // Из clinicalAlerts
    alertCount: { type: Number, default: 0 },
    highAlertCount: { type: Number, default: 0 },
    topAlert: {
      level: String,
      title: String,
      message: String,
      source: String,
    },

    // Из clinicalSeverity
    clinicalSeverity: {
      type: String,
      enum: ["low", "moderate", "high"],
      default: "low",
    },

    // Из prognosis engines
    hospitalizationRisk: { type: Number, default: 0 },
    deteriorationRisk: { type: Number, default: 0 },

    // Когда был последний AI-анализ
    lastAnalyzedAt: { type: Date, default: null },

    // Дата последнего обследования (из cache summary)
    lastExamDate: { type: Date, default: null },

    // Флаг — давно не обследовался
    isOverdue: { type: Boolean, default: false },
    overdueMonths: { type: Number, default: 0 },
  },
  { _id: false },
);

const ComplicationForecastSchema = new mongoose.Schema(
  {
    name: String,
    probability: Number, // 0–1
    patientCount: Number, // сколько пациентов в этом риске
  },
  { _id: false },
);

const DoctorAIDashboardSchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },

    // Сводка
    totalPatients: { type: Number, default: 0 },
    analyzedPatients: { type: Number, default: 0 },

    // Топ пациенты по риску (high + moderate)
    highRiskPatients: [PatientRiskEntrySchema],
    moderateRiskPatients: [PatientRiskEntrySchema],

    // Пациенты без наблюдения > 6 месяцев
    overduePatients: [PatientRiskEntrySchema],

    // Прогноз осложнений по всей панели
    complicationForecast: [ComplicationForecastSchema],

    // Когда последний раз пересчитывался дашборд
    computedAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
    timestamps: false,
  },
);

// TTL — пересчитываем дашборд минимум раз в сутки
DoctorAIDashboardSchema.index(
  { computedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 },
);

export default mongoose.model("DoctorAIDashboard", DoctorAIDashboardSchema);
