// server/common/models/systemLog.js
import mongoose from "mongoose";

const systemLogSchema = new mongoose.Schema({
  action: String,
  details: Object,
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("SystemLog", systemLogSchema);
