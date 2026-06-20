// server/modules/clinic/clinic-reviews/services/review.service.js
//
// Clinic-as-Brand (этап C, модель B+) — бизнес-логика отзывов.
//
// Две дорожки в документе (см. review.model.js):
//   published — видна на витрине (null, пока ничего не одобрено)
//   pending   — правка на модерации (null, если нет ожидающей)
//
//   submit  → пишем в pending, published НЕ трогаем, status=pending
//   approve → published = pending, pending = null, status=approved
//   reject  → pending = null, status=rejected (published без изменений)
//   витрина/рейтинг — ТОЛЬКО по published

import mongoose from "mongoose";
import Review, { REVIEW_STATUS } from "../models/review.model.js";
import Clinic from "../../clinic-core/models/clinic.model.js";
import User from "../../../../common/models/Auth/users.js";

const toId = (v) =>
  typeof v === "string" ? new mongoose.Types.ObjectId(v) : v;

async function decryptAuthorNames(userIds) {
  const uniq = [...new Set(userIds.map(String))];
  if (uniq.length === 0) return new Map();
  const users = await User.find({ _id: { $in: uniq } }).select(
    "firstNameEncrypted lastNameEncrypted avatar",
  );
  const map = new Map();
  for (const u of users) {
    let firstName = "";
    let lastName = "";
    try {
      const dec =
        typeof u.decryptFields === "function" ? u.decryptFields() : {};
      firstName = dec.firstName || "";
      lastName = dec.lastName || "";
    } catch {
      // оставляем пусто
    }
    map.set(String(u._id), { firstName, lastName, avatar: u.avatar || null });
  }
  return map;
}

function publicAuthorName(parts) {
  if (!parts) return "Аноним";
  const fn = (parts.firstName || "").trim();
  const ln = (parts.lastName || "").trim();
  if (!fn && !ln) return "Аноним";
  const initial = ln ? `${ln[0]}.` : "";
  return [fn, initial].filter(Boolean).join(" ") || "Аноним";
}

// ─────────────────────────────────────────────────────────────────────
//  ПАЦИЕНТ
// ─────────────────────────────────────────────────────────────────────

export async function upsertMyReview({ userId, clinicId, rating, text }) {
  if (!userId) throw new Error("upsertMyReview: userId required");
  if (!clinicId) {
    const e = new Error("clinicId required");
    e.statusCode = 400;
    throw e;
  }
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    const e = new Error("rating must be an integer 1..5");
    e.statusCode = 400;
    throw e;
  }
  const cleanText = typeof text === "string" ? text.trim().slice(0, 2000) : "";

  const clinic = await Clinic.findOne({
    _id: toId(clinicId),
    isPublished: true,
    isActive: true,
  })
    .select("_id")
    .lean();
  if (!clinic) {
    const e = new Error("Clinic not found or not published");
    e.statusCode = 404;
    throw e;
  }

  // Найти/создать документ, записать правку в pending (published не трогаем).
  let review = await Review.findOne({
    clinicId: toId(clinicId),
    authorUserId: toId(userId),
  });

  const now = new Date();
  const pendingVersion = { rating: r, text: cleanText, at: now };

  if (!review) {
    review = new Review({
      clinicId: toId(clinicId),
      authorUserId: toId(userId),
      published: null,
      pending: pendingVersion,
      status: REVIEW_STATUS.PENDING,
    });
  } else {
    review.pending = pendingVersion;
    review.status = REVIEW_STATUS.PENDING;
    review.moderatedBy = null;
    review.moderatedAt = null;
    review.moderationNote = null;
  }
  await review.save();

  // Пациенту показываем его актуальную версию (pending приоритетнее)
  const view = review.pending || review.published;
  return {
    id: String(review._id),
    clinicId: String(review.clinicId),
    rating: view?.rating ?? r,
    text: view?.text ?? cleanText,
    status: review.status,
    hasPending: !!review.pending,
    isPublished: !!review.published,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

export async function getMyReview({ userId, clinicId }) {
  if (!userId || !clinicId) return null;
  const doc = await Review.findOne({
    clinicId: toId(clinicId),
    authorUserId: toId(userId),
  }).lean();
  if (!doc) return null;

  // Пациент видит свою последнюю версию: pending приоритетнее published.
  const view = doc.pending || doc.published;
  if (!view) return null;

  return {
    id: String(doc._id),
    clinicId: String(doc.clinicId),
    rating: view.rating,
    text: view.text || "",
    status: doc.status,
    hasPending: !!doc.pending,
    isPublished: !!doc.published,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────
//  ВИТРИНА — только published
// ─────────────────────────────────────────────────────────────────────

export async function getPublicReviewsAggregate(clinicId, { limit = 20 } = {}) {
  const cid = toId(clinicId);

  // Только отзывы с опубликованной версией
  const docs = await Review.find({
    clinicId: cid,
    published: { $ne: null },
  })
    .sort({ "published.at": -1 })
    .limit(Math.min(limit, 50))
    .lean();

  const ratingCount = docs.length;
  const ratingAvg =
    ratingCount > 0
      ? Math.round(
          (docs.reduce((s, r) => s + (r.published?.rating || 0), 0) /
            ratingCount) *
            10,
        ) / 10
      : 0;

  const nameMap = await decryptAuthorNames(docs.map((r) => r.authorUserId));
  const items = docs.map((r) => ({
    id: String(r._id),
    rating: r.published.rating,
    text: r.published.text || "",
    authorName: publicAuthorName(nameMap.get(String(r.authorUserId))),
    createdAt: r.published.at,
  }));

  return { ratingAvg, ratingCount, items };
}

// ─────────────────────────────────────────────────────────────────────
//  ВЛАДЕЛЕЦ — модерация
// ─────────────────────────────────────────────────────────────────────

export async function listClinicReviews({
  clinicId,
  status = null,
  limit = 50,
  skip = 0,
}) {
  const q = { clinicId: toId(clinicId) };
  if (status && Object.values(REVIEW_STATUS).includes(status)) {
    q.status = status;
  }
  const [docs, total] = await Promise.all([
    Review.find(q)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(Math.min(limit, 100))
      .lean(),
    Review.countDocuments(q),
  ]);

  const nameMap = await decryptAuthorNames(docs.map((r) => r.authorUserId));
  const items = docs.map((r) => {
    // Модератору показываем то, что требует внимания: pending приоритетнее.
    const view = r.pending || r.published;
    return {
      id: String(r._id),
      rating: view?.rating ?? 0,
      text: view?.text ?? "",
      status: r.status,
      authorName: publicAuthorName(nameMap.get(String(r.authorUserId))),
      // флаги для UI: есть ли ожидающая правка и есть ли что-то на витрине
      hasPending: !!r.pending,
      isPublished: !!r.published,
      // если правится уже опубликованный отзыв — покажем прежнюю версию
      publishedRating: r.published?.rating ?? null,
      publishedText: r.published?.text ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      moderatedAt: r.moderatedAt,
    };
  });

  return { items, total };
}

export async function moderateReview({
  clinicId,
  reviewId,
  action,
  moderatorUserId,
  note = null,
}) {
  if (action !== "approve" && action !== "reject") {
    const e = new Error("action must be 'approve' or 'reject'");
    e.statusCode = 400;
    throw e;
  }

  const review = await Review.findOne({
    _id: toId(reviewId),
    clinicId: toId(clinicId),
  });
  if (!review) {
    const e = new Error("Review not found");
    e.statusCode = 404;
    throw e;
  }

  if (action === "approve") {
    // Одобряем ожидающую правку → она становится опубликованной.
    if (review.pending) {
      review.published = {
        rating: review.pending.rating,
        text: review.pending.text,
        at: new Date(),
      };
      review.pending = null;
    }
    review.status = REVIEW_STATUS.APPROVED;
  } else {
    // Отклоняем ожидающую правку → published остаётся как был.
    review.pending = null;
    review.status = REVIEW_STATUS.REJECTED;
  }

  review.moderatedBy = toId(moderatorUserId);
  review.moderatedAt = new Date();
  review.moderationNote = typeof note === "string" ? note.slice(0, 500) : null;
  await review.save();

  return {
    id: String(review._id),
    status: review.status,
    isPublished: !!review.published,
    hasPending: !!review.pending,
    moderatedAt: review.moderatedAt,
  };
}

export default {
  upsertMyReview,
  getMyReview,
  getPublicReviewsAggregate,
  listClinicReviews,
  moderateReview,
};
