import mongoose from "mongoose";

const docSchema = new mongoose.Schema(
  {
    type: { type: String, required: true }, // "diploma" | "license" | "id" | ...
    fileUrl: { type: String, required: true }, // или fileId если у тебя есть File model
    fileName: { type: String, default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const VerificationRequestSchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    documents: { type: [docSchema], default: [] },

    // модерация
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    note: { type: String, default: null }, // внутренние заметки админа
  },
  { timestamps: true },
);

export default mongoose.model("VerificationRequest", VerificationRequestSchema);
