// server/common/models/DoctorProfile/doctorReview.js
//
// Отзыв пациента о враче (публичный — растит доверие и SEO на профиле врача).
// Один отзыв на пару (врач, пациент): повторная отправка обновляет прежний.

import mongoose from "mongoose";

const doctorReviewSchema = new mongoose.Schema(
  {
    doctorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
      index: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: { type: Number, min: 1, max: 5, required: true },
    text: { type: String, maxlength: 1000, trim: true, default: "" },
    // Публичный ответ врача на отзыв (растит доверие).
    reply: { type: String, maxlength: 1000, trim: true, default: "" },
    repliedAt: { type: Date, default: null },
    // видимость (на случай модерации админом)
    status: {
      type: String,
      enum: ["visible", "hidden"],
      default: "visible",
    },
  },
  { timestamps: true },
);

// Один отзыв на пару (врач, пациент) — повторная отправка = обновление.
doctorReviewSchema.index({ doctorProfileId: 1, patientId: 1 }, { unique: true });

const DoctorReview =
  mongoose.models.DoctorReview ||
  mongoose.model("DoctorReview", doctorReviewSchema);

export default DoctorReview;
