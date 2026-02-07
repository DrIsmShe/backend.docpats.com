import mongoose from "mongoose";
const { Schema } = mongoose;

const participantSchema = new Schema(
  {
    // 🔗 Привязка к комнате и пользователю
    roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // 👤 Роли и права
    role: {
      type: String,
      enum: [
        "doctor",
        "patient",
        "moderator",
        "admin",
        "viewer",
        "ai_bot", // ИИ-ассистент
      ],
      default: "patient",
    },
    permissions: {
      canWrite: { type: Boolean, default: true },
      canShareScreen: { type: Boolean, default: false },
      canDeleteMessages: { type: Boolean, default: false },
      canMuteOthers: { type: Boolean, default: false },
      canInviteOthers: { type: Boolean, default: false },
      canEditRoom: { type: Boolean, default: false },
    },

    // ⚙️ Состояние подключения
    isOnline: { type: Boolean, default: false },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date },
    lastSeen: { type: Date },
    connectionQuality: { type: Number, min: 0, max: 5 }, // 1–5
    connectionType: {
      type: String,
      enum: ["web", "mobile", "tablet", "unknown"],
      default: "unknown",
    },

    // 🧩 Активность и статистика
    totalMessagesSent: { type: Number, default: 0 },
    totalFilesShared: { type: Number, default: 0 },
    totalCallsJoined: { type: Number, default: 0 },
    avgResponseTimeMs: { type: Number, default: 0 }, // для аналитики
    engagementScore: { type: Number, default: 0 }, // активность участника (0–100)
    participationDurationMs: { type: Number, default: 0 },

    // 📊 Эмоциональные и ИИ метрики
    aiMetrics: {
      sentimentTrend: {
        type: String,
        enum: ["positive", "neutral", "negative", "mixed"],
      },
      empathyIndex: { type: Number, default: 0 },
      stressLevel: { type: Number, default: 0 },
      attentionLevel: { type: Number, default: 0 },
      talkToListenRatio: { type: Number, default: 0 }, // доля речи от общего времени
    },

    // 🌐 Язык и локализация
    language: { type: String, default: "auto" },
    translationEnabled: { type: Boolean, default: false },

    // ❤️ Реакции и взаимодействия
    reactionsGiven: { type: Number, default: 0 },
    lastReactionAt: { type: Date },
    mutedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],

    notifications: {
      muteAll: { type: Boolean, default: false },
      soundEnabled: { type: Boolean, default: true },
      vibrationEnabled: { type: Boolean, default: true },
    },

    // 💻 Устройство и сеть
    deviceInfo: {
      platform: { type: String }, // web / ios / android / desktop
      browser: { type: String },
      deviceModel: { type: String },
      appVersion: { type: String },
    },

    networkInfo: {
      country: { type: String },
      ipAddress: { type: String },
      isp: { type: String },
      avgPingMs: { type: Number },
    },

    // 💰 Оплата и доступ (если это платная консультация)
    billing: {
      hasPaidAccess: { type: Boolean, default: false },
      paymentId: { type: String },
      paidAt: { type: Date },
      accessExpiresAt: { type: Date },
    },

    // 🚨 Модерация
    moderation: {
      isBanned: { type: Boolean, default: false },
      bannedAt: { type: Date },
      bannedBy: { type: Schema.Types.ObjectId, ref: "User" },
      reason: { type: String },
      warningCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// ⚡ Индексы для ускорения поиска
participantSchema.index({ roomId: 1, userId: 1 }, { unique: true });
participantSchema.index({ userId: 1 });
participantSchema.index({ role: 1 });
participantSchema.index({ isOnline: 1 });
participantSchema.index({ "aiMetrics.sentimentTrend": 1 });

// ✅ Создаём модель один раз (предотвращает OverwriteModelError)
const Participant =
  mongoose.models.Participant ||
  mongoose.model("Participant", participantSchema);

export default Participant;
