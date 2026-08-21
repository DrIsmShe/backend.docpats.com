// server/modules/communication/calls/callLog.model.js
//
// Журнал ПАРНЫХ звонков из переписки: кто кому позвонил, чем кончилось.
//
// ИМЯ МОДЕЛИ — DialogCallLog, И ЭТО ВАЖНО. В проекте есть вторая,
// совершенно другая модель журнала звонков —
// common/models/Communication/callLog.js: она описывает видеосессию
// (roomId, callSessionId, качество связи) и живёт в коллекции calllogs.
// Обе регистрировались под именем "CallLog" через
// `mongoose.models.CallLog || mongoose.model("CallLog", ...)`.
//
// Такая запись не защищает, а маскирует: побеждает та модель, что
// загрузилась первой, а вторая молча получает ЧУЖУЮ схему. Первым
// стартует ModelLoader с common/models/**, поэтому гейтвей звонков,
// импортируя этот файл, получал схему видеосессии — и каждая попытка
// записать «кто кому позвонил» падала валидацией:
//
//   startedAt required, callSessionId required, roomId required,
//   status `missed` is not a valid enum value
//
// Ошибка печаталась в консоль и проглатывалась, поэтому снаружи всё
// выглядело исправно, а журнал парных звонков не пополнялся ни разу.
import mongoose from "mongoose";

const { Schema } = mongoose;

export const CALL_STATUSES = ["missed", "declined", "completed", "failed"];
export const CALL_TYPES = ["audio", "video"]; // готово к видео

const CallLogSchema = new Schema(
  {
    dialogId: {
      type: Schema.Types.ObjectId,
      ref: "ChatDialog",
      required: true,
    },
    callerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    calleeId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: CALL_TYPES,
      default: "audio",
    },
    status: {
      type: String,
      enum: CALL_STATUSES,
      required: true,
    },
    startedAt: { type: Date },
    endedAt: { type: Date },
    // длительность в секундах (null если не соединились)
    durationSec: { type: Number, default: null },
  },
  { timestamps: true },
);

CallLogSchema.index({ dialogId: 1, createdAt: -1 });
CallLogSchema.index({ callerId: 1, createdAt: -1 });
CallLogSchema.index({ calleeId: 1, createdAt: -1 });

const CallLogModel =
  mongoose.models.DialogCallLog ||
  mongoose.model("DialogCallLog", CallLogSchema, "call_logs");

export default CallLogModel;
