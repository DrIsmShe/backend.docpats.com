import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, default: null },
    guestId: { type: String, default: null },
    consultationsUsed: { type: Number, default: 0 },
    epicrisesUsed: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const ConsultationSession = mongoose.model(
  "ConsultationSession",
  schema,
);
