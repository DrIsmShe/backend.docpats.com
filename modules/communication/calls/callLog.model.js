// server/modules/communication/calls/callLog.model.js
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
      index: true,
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
  mongoose.models.CallLog ||
  mongoose.model("CallLog", CallLogSchema, "call_logs");

export default CallLogModel;
