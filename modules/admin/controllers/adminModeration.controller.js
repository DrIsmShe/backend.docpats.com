// modules/admin/controllers/adminModeration.controller.js
//
// п.3 Модерация отзывов (clinic_reviews) + п.4 Управление фичами клиник.
// Всё под requireAdmin.

import mongoose from "mongoose";
import Review from "../../clinic/clinic-reviews/models/review.model.js";
import Clinic from "../../clinic/clinic-core/models/clinic.model.js";
import {
  FEATURES,
  getEnabledFeatures,
  enableFeature,
  disableFeature,
} from "../../../common/services/featureFlag.service.js";
import { auditAdminAccess } from "../adminAudit.js";

// ─── GET /admin/reviews ────────────────────────────────────────
// Отзывы о клиниках. Фильтр: status (pending/approved/rejected). Пагинация.
export async function listReviews(req, res) {
  try {
    const { status, limit = 50, skip = 0 } = req.query;
    const filter = {};
    if (["pending", "approved", "rejected"].includes(status)) {
      filter.status = status;
    }
    const lim = Math.min(Number(limit) || 50, 200);
    const sk = Math.max(Number(skip) || 0, 0);

    const [rows, total] = await Promise.all([
      Review.find(filter).sort({ updatedAt: -1 }).skip(sk).limit(lim).lean(),
      Review.countDocuments(filter),
    ]);

    const clinicIds = [...new Set(rows.map((r) => String(r.clinicId)))];
    const clinics = await Clinic.find({ _id: { $in: clinicIds } })
      .select("name slug")
      .lean();
    const cmap = new Map(clinics.map((c) => [String(c._id), c]));

    res.json({
      reviews: rows.map((r) => ({
        _id: String(r._id),
        clinicId: String(r.clinicId),
        clinicName: cmap.get(String(r.clinicId))?.name || null,
        status: r.status,
        rating: r.published?.rating ?? r.pending?.rating ?? null,
        text: r.published?.text ?? r.pending?.text ?? "",
        hasPending: !!r.pending,
        moderatedAt: r.moderatedAt || null,
        updatedAt: r.updatedAt,
      })),
      total,
      limit: lim,
      skip: sk,
    });
  } catch (err) {
    console.error("adminModeration.listReviews:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// ─── PATCH /admin/reviews/:id ──────────────────────────────────
// Модерация: action = approve | reject | hide. body: { action }
export async function moderateReview(req, res) {
  try {
    const { id } = req.params;
    const { action } = req.body || {};
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid review id" });
    }
    const review = await Review.findById(id);
    if (!review) return res.status(404).json({ message: "Review not found" });

    const adminId = req.userId || req.session?.userId;
    if (action === "approve") {
      if (review.pending) {
        review.published = review.pending;
        review.pending = null;
      }
      review.status = "approved";
    } else if (action === "reject") {
      review.pending = null;
      review.status = "rejected";
    } else if (action === "hide") {
      review.published = null;
      review.status = "rejected";
    } else {
      return res.status(400).json({ message: "action: approve|reject|hide" });
    }
    review.moderatedBy = adminId;
    review.moderatedAt = new Date();
    await review.save();

    auditAdminAccess(req, {
      action: "update",
      resourceType: "other",
      resourceId: id,
      metadata: { view: "review-moderation", moderation: action },
    });

    res.json({ success: true, status: review.status });
  } catch (err) {
    console.error("adminModeration.moderateReview:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// ─── GET /admin/clinics/:id/features ───────────────────────────
// Фичи клиники: полный список FEATURES с флагом enabled (тариф + overrides).
export async function getClinicFeatures(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }
    const enabled = await getEnabledFeatures(id); // Set
    const enabledSet = enabled instanceof Set ? enabled : new Set(enabled || []);

    res.json({
      features: Object.values(FEATURES).map((f) => ({
        feature: f,
        enabled: enabledSet.has(f),
      })),
    });
  } catch (err) {
    console.error("adminModeration.getClinicFeatures:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// ─── PATCH /admin/clinics/:id/features ─────────────────────────
// Включить/выключить фичу клинике. body: { feature, enabled }
export async function setClinicFeature(req, res) {
  try {
    const { id } = req.params;
    const { feature, enabled } = req.body || {};
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }
    if (!Object.values(FEATURES).includes(feature)) {
      return res.status(400).json({ message: "Unknown feature" });
    }
    const adminId = req.userId || req.session?.userId;
    if (enabled === true) {
      await enableFeature(feature, id, adminId);
    } else {
      await disableFeature(feature, id);
    }

    auditAdminAccess(req, {
      action: "update",
      resourceType: "clinic",
      resourceId: id,
      metadata: { view: "feature-flag", feature, enabled: enabled === true },
    });

    res.json({ success: true, feature, enabled: enabled === true });
  } catch (err) {
    console.error("adminModeration.setClinicFeature:", err);
    res.status(500).json({ message: "Server error" });
  }
}
