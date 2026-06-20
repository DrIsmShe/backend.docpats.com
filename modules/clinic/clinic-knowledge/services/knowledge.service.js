// server/modules/clinic/clinic-knowledge/services/knowledge.service.js
//
// Business logic for ClinicKnowledgeArticle.
//
// Conventions (mirrors room/equipment services):
//   - clinicId is ALWAYS an explicit argument (no ALS); tenant-scoped.
//   - NO requirePerm here — RBAC lives upstream + frontend, like the other
//     clinic-* modules.
//   - departmentId is optional but, when set, must be a department of THIS
//     clinic (we allow archived departments too — knowledge can outlive a
//     reorg, so we only check ownership, not active status).

import ClinicKnowledgeArticle from "../models/clinicKnowledgeArticle.model.js";
import {
  ValidationError,
  NotFoundError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

// Content fields whose change should bump the version counter.
const CONTENT_FIELDS = ["title", "body", "summary"];

// Validate that departmentId, if given, belongs to this clinic.
// Returns the id (string|ObjectId) or null. Throws if foreign.
async function assertDepartmentOwnership(clinicId, departmentId) {
  if (!departmentId) return null;

  const { ClinicDepartment } =
    await import("../../clinic-departments/models/clinicDepartment.model.js");
  const dep = await ClinicDepartment.findOne({
    _id: departmentId,
    clinicId,
  })
    .select("_id")
    .lean();

  if (!dep) {
    throw new ValidationError("departmentId not found in this clinic");
  }
  return dep._id;
}

// ─── createArticle ─────────────────────────────────────────────────────
export async function createArticle(clinicId, input) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const departmentId = await assertDepartmentOwnership(
    clinicId,
    input.departmentId,
  );

  const status = input.status ?? "draft";

  const doc = await ClinicKnowledgeArticle.create({
    clinicId,
    departmentId,
    title: input.title,
    body: input.body ?? "",
    summary: input.summary ?? null,
    category: input.category ?? "other",
    tags: input.tags ?? [],
    visibility: input.visibility ?? "all",
    status,
    pinned: input.pinned ?? false,
    version: 1,
    publishedAt: status === "published" ? new Date() : null,
    createdBy: input.actorId ?? null,
  });
  return doc.toObject();
}

// ─── listArticles ─────────────────────────────────────────────────────
export async function listArticles(clinicId, filters = {}) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const query = { clinicId };
  if (filters.category) query.category = filters.category;
  if (filters.status) query.status = filters.status;
  if (filters.departmentId) query.departmentId = filters.departmentId;
  if (filters.visibility) query.visibility = filters.visibility;
  if (filters.tag) query.tags = filters.tag;

  if (filters.q && filters.q.trim()) {
    const safe = filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(safe, "i");
    query.$or = [{ title: rx }, { summary: rx }, { tags: rx }];
  }

  // Pinned first, then most-recently-updated.
  return ClinicKnowledgeArticle.find(query)
    .sort({ pinned: -1, updatedAt: -1 })
    .lean();
}

// ─── getArticleById ─────────────────────────────────────────────────────
export async function getArticleById(clinicId, id) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const doc = await ClinicKnowledgeArticle.findOne({
    _id: id,
    clinicId,
  }).lean();
  if (!doc) throw new NotFoundError("Article not found");
  return doc;
}

// ─── updateArticle ─────────────────────────────────────────────────────
export async function updateArticle(clinicId, id, input) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const existing = await ClinicKnowledgeArticle.findOne({ _id: id, clinicId });
  if (!existing) throw new NotFoundError("Article not found");

  const update = {};

  if (input.departmentId !== undefined) {
    update.departmentId = await assertDepartmentOwnership(
      clinicId,
      input.departmentId,
    );
  }
  if (input.title !== undefined) update.title = input.title;
  if (input.body !== undefined) update.body = input.body ?? "";
  if (input.summary !== undefined) update.summary = input.summary ?? null;
  if (input.category !== undefined) update.category = input.category;
  if (input.tags !== undefined) update.tags = input.tags;
  if (input.visibility !== undefined) update.visibility = input.visibility;
  if (input.pinned !== undefined) update.pinned = input.pinned;
  if (input.actorId !== undefined) update.updatedBy = input.actorId;

  // Status transitions: stamp publishedAt the first time it goes published.
  if (input.status !== undefined && input.status !== existing.status) {
    update.status = input.status;
    if (input.status === "published" && !existing.publishedAt) {
      update.publishedAt = new Date();
    }
  }

  // Bump version when any content field actually changes.
  const contentChanged = CONTENT_FIELDS.some(
    (f) => update[f] !== undefined && update[f] !== existing[f],
  );
  if (contentChanged) update.version = (existing.version || 1) + 1;

  const doc = await ClinicKnowledgeArticle.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: update },
    { new: true, runValidators: true },
  ).lean();
  if (!doc) throw new NotFoundError("Article not found");
  return doc;
}

// ─── archiveArticle (soft delete → status: archived) ───────────────────
export async function archiveArticle(clinicId, id) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const doc = await ClinicKnowledgeArticle.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: { status: "archived" } },
    { new: true },
  ).lean();
  if (!doc) throw new NotFoundError("Article not found");

  logger?.info?.(
    { clinicId: String(clinicId), articleId: String(id) },
    "knowledge article archived",
  );
  return doc;
}
