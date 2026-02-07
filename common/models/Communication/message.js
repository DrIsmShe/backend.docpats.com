import mongoose from "mongoose";
const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    // 🔗 Привязки
    roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    replyTo: { type: Schema.Types.ObjectId, ref: "Message" },
    threadId: { type: Schema.Types.ObjectId, ref: "Message" },

    // 💬 Типы сообщений
    type: {
      type: String,
      enum: [
        "text",
        "image",
        "file",
        "audio",
        "video",
        "form", // медицинская форма (рекомендация, диагноз)
        "system", // системное сообщение
        "ai_reply", // ответ ИИ
        "reaction", // 👍❤️✅
        "report_link", // ссылка на медицинский отчёт
        "event", // события: вход, выход, приглашение
      ],
      default: "text",
    },

    // 📝 Контент
    content: { type: String, trim: true },
    quotedText: { type: String }, // сохранённый текст для reply
    attachments: [
      {
        fileUrl: { type: String },
        mimeType: { type: String },
        fileName: { type: String },
        fileSize: { type: Number },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    // 🧩 Реакции
    reactions: [
      {
        emoji: String,
        userId: { type: Schema.Types.ObjectId, ref: "User" },
        addedAt: { type: Date, default: Date.now },
      },
    ],

    // ⚕️ Медицинские данные
    medicalContext: {
      diagnosis: { type: String },
      recommendation: { type: String },
      reportId: { type: Schema.Types.ObjectId, ref: "MedicalReport" },
      icd10Code: { type: String },
    },

    // 🧠 AI-анализ и расширенная семантика
    aiAnalysis: {
      sentiment: { type: String }, // positive / neutral / negative
      keywords: [{ type: String }],
      summary: { type: String },
      entities: [{ type: String }], // имена, лекарства, диагнозы
      icd10Codes: [{ type: String }],
      actionRecommendation: { type: String },
      urgencyLevel: { type: String, enum: ["low", "medium", "high"] },
      translatedLanguages: [{ lang: String, text: String }],
      translation: { type: String },
      toxicityScore: { type: Number },
      detectedLanguage: { type: String },
      confidence: { type: Number }, // уверенность ИИ
      analyzedAt: { type: Date },
    },

    // 🧭 Контекст и интерактивность
    interactive: {
      type: {
        type: String,
        enum: ["poll", "form", "button", "rating", "link", "consent"],
      },
      data: { type: Schema.Types.Mixed },
      expiresAt: { type: Date }, // для опросов или форм с ограничением по времени
    },

    // 🔒 Безопасность
    security: {
      isSensitive: { type: Boolean, default: false },
      encryptedAt: { type: Date },
      accessedBy: [
        {
          userId: { type: Schema.Types.ObjectId, ref: "User" },
          accessedAt: { type: Date },
        },
      ],
      requiresConsent: { type: Boolean, default: false },
    },

    // 🧠 Метаданные, полезные для ИИ и аналитики
    contextTags: [{ type: String }], // “рентген”, “анализ крови”, “терапия”
    metadata: { type: Schema.Types.Mixed }, // для внешних систем (Zoom, Agora и т.п.)

    // 📅 Статусы
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },

    deliveredAt: { type: Date },
    readAt: { type: Date },
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    deliveredTo: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // 📊 Статистика
    wordCount: { type: Number, default: 0 },
    charCount: { type: Number, default: 0 },
    threadCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ⚡ Индексы для быстрого поиска и аналитики
messageSchema.index({ roomId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ "aiAnalysis.keywords": 1 });
messageSchema.index({ "aiAnalysis.sentiment": 1 });
messageSchema.index({ "medicalContext.icd10Code": 1 });
messageSchema.index({ type: 1 });

// ✅ Безопасное создание модели
const Message =
  mongoose.models.Message || mongoose.model("Message", messageSchema);

export default Message;
