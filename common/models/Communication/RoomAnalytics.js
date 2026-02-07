import mongoose from "mongoose";
const { Schema } = mongoose;

/**
 * Аналитическая модель для комнаты общения
 * Используется ИИ и сервисами статистики для вычисления эффективности консультаций, консилиумов и чатов.
 */

const roomAnalyticsSchema = new Schema(
  {
    // 🔗 Привязка к комнате
    roomId: {
      type: Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      unique: true,
    },

    // 📊 Общая статистика
    totalMessages: { type: Number, default: 0 },
    totalFiles: { type: Number, default: 0 },
    totalAudioMessages: { type: Number, default: 0 },
    totalVideoMessages: { type: Number, default: 0 },

    // 🕓 Средние значения
    avgMessageLength: { type: Number, default: 0 }, // средняя длина сообщений в символах
    avgResponseTimeMs: { type: Number, default: 0 }, // среднее время ответа
    avgEngagementDurationMs: { type: Number, default: 0 }, // средняя длительность активного общения
    avgTurnTakingRate: { type: Number, default: 0 }, // частота смены говорящих

    // 😊 Эмоциональный анализ
    sentimentDistribution: {
      positive: { type: Number, default: 0 },
      neutral: { type: Number, default: 0 },
      negative: { type: Number, default: 0 },
    },

    // 🧠 Ключевые слова и темы
    topKeywords: [{ type: String }], // ["diabetes", "MRI", "treatment"]
    topicsDetected: [{ type: String }], // ["cardiology", "neurology"]
    contextTags: [{ type: String }], // ["consultation", "emergency", "education"]
    languageDistribution: [
      {
        lang: { type: String },
        percent: { type: Number, default: 0 },
      },
    ],

    // 👩‍⚕️ Активность участников
    doctorEngagement: { type: Number, default: 0 }, // 0–100
    patientEngagement: { type: Number, default: 0 }, // 0–100
    dominantSpeakerId: { type: Schema.Types.ObjectId, ref: "User" }, // кто говорил больше
    participantActivityMap: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User" },
        messageCount: { type: Number, default: 0 },
        avgResponseTimeMs: { type: Number, default: 0 },
        speakingTimeMs: { type: Number, default: 0 },
      },
    ],

    // 🧾 Отчёты и оценки
    satisfactionScore: { type: Number, min: 0, max: 5, default: 0 }, // оценка пациента
    reportGenerated: { type: Boolean, default: false },
    lastAnalyzedAt: { type: Date },

    // ⚙️ Метаданные
    analysisVersion: { type: String, default: "1.0.0" },
    analyzedBy: { type: String, default: "system" }, // system / ai_service / admin
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },

    // 🧩 Расширенные ИИ-метрики
    aiInsights: {
      stressLevel: { type: Number, default: 0 }, // 0–100
      empathyIndex: { type: Number, default: 0 },
      interruptions: { type: Number, default: 0 },
      medicalAccuracy: { type: Number, default: 0 },
      conversationComplexity: { type: Number, default: 0 }, // степень сложности темы
      dataIntegrityScore: { type: Number, default: 100 }, // доверие к данным (0–100)
    },

    // 🧮 Для обучения ML-моделей
    featureVector: [{ type: Number }],
  },
  { timestamps: true }
);

// 🔍 Индексы для быстрой аналитики
roomAnalyticsSchema.index({ roomId: 1 });
roomAnalyticsSchema.index({ "sentimentDistribution.positive": -1 });
roomAnalyticsSchema.index({ doctorEngagement: -1 });
roomAnalyticsSchema.index({ patientEngagement: -1 });
roomAnalyticsSchema.index({ topKeywords: 1 });
roomAnalyticsSchema.index({ "aiInsights.empathyIndex": -1 });

// ⚙️ Автоматическая нормализация значений перед сохранением
roomAnalyticsSchema.pre("save", function (next) {
  if (this.totalMessages > 0) {
    const total =
      this.sentimentDistribution.positive +
      this.sentimentDistribution.neutral +
      this.sentimentDistribution.negative;

    if (total > 100) {
      const factor = 100 / total;
      this.sentimentDistribution.positive *= factor;
      this.sentimentDistribution.neutral *= factor;
      this.sentimentDistribution.negative *= factor;
    }
  }
  next();
});

// ✅ Безопасное создание модели
const RoomAnalytics =
  mongoose.models.RoomAnalytics ||
  mongoose.model("RoomAnalytics", roomAnalyticsSchema);

export default RoomAnalytics;
