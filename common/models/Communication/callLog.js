Нашли. Последняя строка — классическая ошибка:
jsexport default mongoose.model("CallLog", callLogSchema);
При повторной загрузке (когда simulation.worker тоже импортирует) — взрыв OverwriteModelError. Заменим на безопасный паттерн:
bashcd ~/app/backend.docpats.com

# Backup
cp common/models/Communication/callLog.js common/models/Communication/callLog.js.backup

# Полная перезапись
cat > common/models/Communication/callLog.js << 'EOF'
import mongoose from "mongoose";

const callLogSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true },
    type: { type: String, enum: ["video", "audio"], default: "video" },
    status: {
      type: String,
      enum: ["active", "ended", "failed"],
      default: "ended",
    },
    callSessionId: { type: String, required: true, index: true, unique: true },

    startedAt: { type: Date, required: true },
    endedAt: { type: Date },
    durationSec: { type: Number, default: 0 },

    caller: {
      type: String,
      enum: ["doctor", "patient", "unknown"],
      default: "unknown",
    },
    callee: {
      type: String,
      enum: ["doctor", "patient", "unknown"],
      default: "unknown",
    },

    callerUserId: { type: String },
    calleeUserId: { type: String },

    callerName: { type: String },
    calleeName: { type: String },

    callerIP: { type: String },
    calleeIP: { type: String },

    callerConnectionQuality: {
      type: String,
      enum: ["excellent", "good", "fair", "poor", "unknown"],
      default: "unknown",
    },
    calleeConnectionQuality: {
      type: String,
      enum: ["excellent", "good", "fair", "poor", "unknown"],
      default: "unknown",
    },

    errorReason: { type: String, default: null },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

callLogSchema.pre("save", function (next) {
  if (this.startedAt && this.endedAt && !this.durationSec) {
    this.durationSec = Math.round((this.endedAt - this.startedAt) / 1000);
  }
  next();
});

const CallLog =
  mongoose.models.CallLog || mongoose.model("CallLog", callLogSchema);

export default CallLog;