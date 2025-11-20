import mongoose from "mongoose";
const { Schema } = mongoose;

const roomSchema = new Schema(
  {
    // Тип комнаты
    type: {
      type: String,
      enum: [
        "private", // 1:1 чат
        "group", // группа врачей
        "consultation", // пациент-врач
        "consilium", // врачебный консилиум
        "conference", // вебинар
        "ai_assist", // диалог с ИИ (в будущем)
      ],
      default: "private",
    },

    title: { type: String, trim: true },
    description: { type: String },

    // Создатель комнаты
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // Привязка к приёму или клиническому случаю
    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment" },
    patientId: { type: Schema.Types.ObjectId, ref: "User" },
    doctorIds: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // Настройки комнаты
    settings: {
      allowFiles: { type: Boolean, default: true },
      allowVoice: { type: Boolean, default: true },
      allowVideo: { type: Boolean, default: true },
      allowScreenShare: { type: Boolean, default: true },
      autoRecord: { type: Boolean, default: false },
      autoCloseAfterMinutes: { type: Number, default: 60 },
      maxParticipants: { type: Number, default: 10 },
      isEncrypted: { type: Boolean, default: true },
    },

    // Статус комнаты
    status: {
      type: String,
      enum: ["active", "scheduled", "ended", "archived", "cancelled"],
      default: "active",
    },

    // Метаданные для ИИ
    aiMetadata: {
      summary: { type: String },
      topics: [{ type: String }],
      sentiment: { type: String },
      keywords: [{ type: String }],
      reportGenerated: { type: Boolean, default: false },
      lastAnalyzedAt: { type: Date },
    },

    // Управление доступом
    access: {
      visibility: {
        type: String,
        enum: ["private", "internal", "public", "restricted"],
        default: "private",
      },
      allowedRoles: [{ type: String }],
      allowedUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      blockedUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      passwordProtected: { type: Boolean, default: false },
      passwordHash: { type: String },
    },

    // Ассистенты ИИ
    aiAssistants: [
      {
        type: {
          type: String,
          enum: ["summary_bot", "diagnosis_bot", "translator", "moderator_bot"],
        },
        active: { type: Boolean, default: true },
        personality: { type: String },
        config: { type: Schema.Types.Mixed },
      },
    ],

    // Логи активности
    audit: {
      createdIp: { type: String },
      lastAccessIp: { type: String },
      lastAccessAt: { type: Date },
      activityScore: { type: Number, default: 0 },
      messageCount: { type: Number, default: 0 },
      callCount: { type: Number, default: 0 },
    },

    // Контекст (гео, язык)
    context: {
      region: { type: String },
      language: { type: String, default: "az" },
      timezone: { type: String, default: "Asia/Baku" },
    },

    // Рейтинг
    rating: {
      average: { type: Number, min: 0, max: 5, default: 0 },
      count: { type: Number, default: 0 },
      lastRatedAt: { type: Date },
    },

    // Теги, архив, удаление
    tags: [{ type: String }],
    archivedAt: { type: Date },
    deletedAt: { type: Date },

    // Для масштабирования
    shardKey: { type: String, index: true },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// 📌 Индексы
roomSchema.index({ type: 1, createdBy: 1 });
roomSchema.index({ appointmentId: 1 });
roomSchema.index({ status: 1 });
roomSchema.index({ "aiMetadata.keywords": 1 });
roomSchema.index(
  { createdBy: 1, appointmentId: 1, type: 1 },
  { unique: false }
);

// ✅ Создаём модель один раз
const Room = mongoose.models.Room || mongoose.model("Room", roomSchema);

export default Room;
