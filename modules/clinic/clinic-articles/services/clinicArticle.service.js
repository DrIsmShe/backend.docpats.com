// server/modules/clinic/clinic-articles/services/clinicArticle.service.js

import ClinicArticle from "../models/clinicArticle.model.js";
import ClinicCustomPage from "../../clinic-pages/models/clinicCustomPage.model.js";
import slugify from "slugify";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../../common/utils/errors.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";
import { sanitizeArticleBody } from "../utils/sanitizeArticleBody.js";

function normSlug(s) {
  return slugify(String(s || ""), { lower: true, strict: true });
}

/** Список статей. filters: { pageId?, status? } */
export async function listArticles(filters = {}) {
  const q = {};
  if (filters.pageId) q.pageId = filters.pageId;
  if (filters.status) q.status = filters.status;
  return ClinicArticle.find(q).sort({ order: 1, createdAt: -1 }).lean();
}

/**
 * ADMIN: список статей всех клиник (для модерации проектом).
 * filters: { clinicId?, moderation?, status?, q? } + пагинация { limit, skip }.
 * Вне tenant-контекста — админ видит всё.
 */
export async function adminListArticles(filters = {}, paging = {}) {
  const q = {};
  if (filters.clinicId) q.clinicId = filters.clinicId;
  if (filters.moderation) q.moderation = filters.moderation;
  if (filters.status) q.status = filters.status;
  if (filters.q) q.title = { $regex: String(filters.q).trim(), $options: "i" };

  const limit = Math.min(Math.max(Number(paging.limit) || 50, 1), 200);
  const skip = Math.max(Number(paging.skip) || 0, 0);

  const [items, total] = await Promise.all([
    ClinicArticle.find(q)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ClinicArticle.countDocuments(q),
  ]);
  return { items, total, limit, skip };
}

export async function getArticle(articleId) {
  const a = await ClinicArticle.findById(articleId).lean();
  if (!a) throw new NotFoundError("ClinicArticle");
  return a;
}

export async function createArticle(data) {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ValidationError("No clinic context");

  // страница-категория должна существовать и принадлежать этой клинике
  const page = await ClinicCustomPage.findOne({
    _id: data.pageId,
    clinicId,
  })
    .select("_id")
    .lean();
  if (!page) throw new ValidationError("Category page not found");

  const slug = normSlug(data.slug || data.title);
  if (!slug) throw new ValidationError("slug or title required");

  const clash = await ClinicArticle.findOne({ pageId: data.pageId, slug })
    .select("_id")
    .lean();
  if (clash) {
    throw new ConflictError(`Article slug "${slug}" already exists`, {
      field: "slug",
    });
  }

  const doc = await ClinicArticle.create({
    ...data,
    body: sanitizeArticleBody(data.body),
    clinicId,
    slug,
  });
  return doc.toObject();
}

export async function updateArticle(articleId, updates) {
  const a = await ClinicArticle.findById(articleId);
  if (!a) throw new NotFoundError("ClinicArticle");

  if (updates.slug !== undefined || updates.title !== undefined) {
    const next = normSlug(updates.slug || updates.title || a.slug);
    if (next && next !== a.slug) {
      const clash = await ClinicArticle.findOne({
        pageId: a.pageId,
        slug: next,
        _id: { $ne: a._id },
      })
        .select("_id")
        .lean();
      if (clash) {
        throw new ConflictError(`Article slug "${next}" already exists`, {
          field: "slug",
        });
      }
      a.slug = next;
    }
  }

  const { slug, ...rest } = updates;
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    a[k] = k === "body" ? sanitizeArticleBody(v) : v;
  }
  await a.save();
  return a.toObject();
}

export async function setArticlePublished(articleId, status) {
  const a = await ClinicArticle.findById(articleId);
  if (!a) throw new NotFoundError("ClinicArticle");
  a.status = status;
  await a.save();
  return a.toObject();
}

/** Рубильник проекта (admin): moderation ok|disabled. */
export async function setArticleModeration(articleId, moderation, note = "") {
  const a = await ClinicArticle.findById(articleId);
  if (!a) throw new NotFoundError("ClinicArticle");
  a.moderation = moderation;
  a.moderationNote = note || "";
  await a.save();
  return a.toObject();
}

export async function removeArticle(articleId) {
  const a = await ClinicArticle.findById(articleId);
  if (!a) throw new NotFoundError("ClinicArticle");
  await a.softDelete();
  return { id: String(a._id), deleted: true };
}
