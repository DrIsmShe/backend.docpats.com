import mongoose from "mongoose";

const AISummaryCacheSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    dataHash: {
      type: String,
      required: true,
      index: true,
    },

    summary: {
      type: Object,
      required: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false },
);

export default mongoose.model("AISummaryCache", AISummaryCacheSchema);
