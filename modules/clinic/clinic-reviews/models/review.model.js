// server/modules/clinic/clinic-reviews/models/review.model.js
//
// Clinic-as-Brand (этап C, модель B+) — отзыв пациента о клинике.
//
// Две "дорожки" в одном документе:
//   published — версия, видимая на витрине (null, пока ничего не одобрено)
//   pending   — правка на модерации (null, если ожидающей правки нет)
//
// Поведение:
//   - первый/повторный submit пишет в pending (published не трогается)
//   - approve: published = pending, pending = null, status = approved
//   - reject:  pending = null, status = rejected (published без изменений)
//   - витрина и рейтинг считаются ТОЛЬКО по published
//
// 1 отзыв на пару пациент+клиника (unique index) — честный рейтинг.
// НЕ PHI (оценка + свободный текст) → не шифруется.

import mongoose from "mongoose";

const { Schema } = mongoose;

export const REVIEW_STATUS = Object.freeze({
  PENDING: "pending", // есть ожидающая правка (pending != null)
  APPROVED: "approved", // опубликовано, ожидающей правки нет
  REJECTED: "rejected", // последняя правка отклонена
});

// Снимок версии отзыва (одна дорожка)
const versionSchema = new Schema(
  {
    rating: { type: Number, min: 1, max: 5, required: true },
    text: { type: String, default: "", trim: true, maxlength: 2000 },
    at: { type: Date, default: Date.now }, // submittedAt / approvedAt
  },
  { _id: false },
);

const reviewSchema = new Schema(
  {
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    authorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Видна на витрине. null, пока модератор ничего не одобрил.
    published: { type: versionSchema, default: null },

    // Правка на модерации. null, если ожидающей правки нет.
    pending: { type: versionSchema, default: null },

    status: {
      type: String,
      enum: Object.values(REVIEW_STATUS),
      default: REVIEW_STATUS.PENDING,
      index: true,
    },

    moderatedBy: { type: Schema.Types.ObjectId, default: null },
    moderatedAt: { type: Date, default: null },
    moderationNote: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true, collection: "clinic_reviews" },
);

reviewSchema.index({ clinicId: 1, authorUserId: 1 }, { unique: true });
reviewSchema.index({ clinicId: 1, status: 1, createdAt: -1 });

const Review = mongoose.models.Review || mongoose.model("Review", reviewSchema);

export default Review;
