import mongoose from "mongoose";
const { Schema } = mongoose;

const callSessionSchema = new Schema(
  {
    // 🔗 Привязки
    roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment" },
    reportId: { type: Schema.Types.ObjectId, ref: "MedicalReport" },
    startedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    endedBy: { type: Schema.Types.ObjectId, ref: "User" },

    // 📞 Тип звонка
    type: {
      type: String,
      enum: ["audio", "video", "screen_share", "group_call", "conference"],
      default: "video",
    },

    // ⏱ Время и длительность
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    durationMs: { type: Number, default: 0 },
    billingDurationMinutes: { type: Number, default: 0 },

    // 👥 Участники
    participants: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User" },
        role: {
          type: String,
          enum: ["doctor", "patient", "moderator", "guest", "ai_assistant"],
        },
        joinedAt: { type: Date },
        leftAt: { type: Date },
        connectionQuality: { type: Number, min: 0, max: 5 },
        device: { type: String }, // web, ios, android, desktop
        network: { type: String }, // wifi, 4g, 5g
        avgLatencyMs: { type: Number },
        packetLoss: { type: Number },
      },
    ],

    // 📡 Статус и сигналы
    status: {
      type: String,
      enum: [
        "initiated",
        "ringing",
        "active",
        "paused",
        "ended",
        "missed",
        "failed",
      ],
      default: "initiated",
    },
    disconnectReason: { type: String },
    reconnectCount: { type: Number, default: 0 },

    // 🎥 Медиа и записи
    recordingUrl: { type: String },
    transcriptUrl: { type: String },
    thumbnailUrl: { type: String },
    streamServer: {
      type: String,
      enum: ["webrtc", "twilio", "agora", "zoom", "mediasoup", "other"],
      default: "webrtc",
    },
    isRecorded: { type: Boolean, default: false },
    storageProvider: { type: String, default: "local" }, // local / s3 / gcp / azure

    // 📊 Сетевые показатели (глобальные)
    avgBitrateKbps: { type: Number },
    packetLoss: { type: Number },
    latencyMs: { type: Number },
    bandwidthStats: {
      avgUpload: { type: Number },
      avgDownload: { type: Number },
      maxUpload: { type: Number },
      maxDownload: { type: Number },
    },

    // 🧠 ИИ-анализ звонка
    aiSummary: {
      transcriptSummary: { type: String },
      detectedKeywords: [{ type: String }],
      emotionTone: { type: String },
      autoReportGenerated: { type: Boolean, default: false },
      topics: [{ type: String }],
      languageDetected: { type: String },
      confidence: { type: Number },
      analyzedAt: { type: Date },
    },

    // 🎙️ Расшифровка речи
    transcription: {
      text: { type: String },
      language: { type: String },
      confidence: { type: Number },
      segments: [
        {
          speaker: { type: String },
          text: { type: String },
          startTime: { type: Number },
          endTime: { type: Number },
        },
      ],
    },

    // 😊 Эмоциональный анализ
    emotionAnalysis: {
      doctorTone: { type: String },
      patientTone: { type: String },
      empathyIndex: { type: Number },
      stressLevel: { type: Number },
      sentimentRatio: {
        positive: { type: Number, default: 0 },
        neutral: { type: Number, default: 0 },
        negative: { type: Number, default: 0 },
      },
    },

    // 💰 Биллинг и оплата консультации
    billing: {
      isPaid: { type: Boolean, default: false },
      paymentStatus: {
        type: String,
        enum: ["pending", "paid", "failed"],
        default: "pending",
      },
      price: { type: Number, default: 0 },
      currency: { type: String, default: "AZN" },
      paidAt: { type: Date },
      paymentId: { type: String },
    },

    // 📑 Контекст и логирование
    context: {
      region: { type: String },
      language: { type: String, default: "az" },
      timezone: { type: String, default: "Asia/Baku" },
      createdIp: { type: String },
      lastAccessIp: { type: String },
    },

    // ⚙️ Прочее
    isConfidential: { type: Boolean, default: false },
    notes: { type: String },
  },
  { timestamps: true }
);

// ⏳ Виртуальное поле для расчёта длительности (в минутах)
callSessionSchema.virtual("durationMinutes").get(function () {
  if (!this.endedAt) return 0;
  return Math.round((this.endedAt - this.startedAt) / 60000);
});

// 📈 Индексы
callSessionSchema.index({ roomId: 1, status: 1 });
callSessionSchema.index({ appointmentId: 1 });
callSessionSchema.index({ "aiSummary.detectedKeywords": 1 });
callSessionSchema.index({ "billing.paymentStatus": 1 });
callSessionSchema.index({ type: 1 });
callSessionSchema.index({ startedAt: -1 });

// ✅ Безопасное создание модели (предотвращает OverwriteModelError)
const CallSession =
  mongoose.models.CallSession ||
  mongoose.model("CallSession", callSessionSchema);

export default CallSession;
