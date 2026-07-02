// server/modules/clinic/clinic-pages/services/clinicCustomPage.service.js
//
// Сервис кастомных страниц. tenantScopedPlugin сам подмешивает clinicId из
// AsyncLocalStorage в запросы, но для create мы ставим clinicId явно из
// контекста (надёжнее: required-валидация модели срабатывает до плагина).

import ClinicCustomPage from "../models/clinicCustomPage.model.js";
import slugify from "slugify";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../../common/utils/errors.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";

function normalizeSlug(input) {
  return slugify(String(input || ""), { lower: true, strict: true });
}

/**
 * Проверить корректность parentId (двухуровневая иерархия).
 * @param {string|null} parentId
 * @param {ObjectId} clinicId
 * @param {string|null} selfId  id текущей страницы (для защиты self-parent при update)
 * @returns {Promise<ObjectId|null>} нормализованный parentId или null
 */
async function resolveParentId(parentId, clinicId, selfId = null) {
  if (parentId === null || parentId === undefined || parentId === "") {
    return null; // корневая категория
  }
  if (selfId && String(parentId) === String(selfId)) {
    throw new ValidationError("Категория не может быть родителем сама себе");
  }
  const parent = await ClinicCustomPage.findOne({ _id: parentId, clinicId })
    .select("_id parentId")
    .lean();
  if (!parent) {
    throw new ValidationError("Родительская категория не найдена");
  }
  // защита от третьего уровня: родитель сам должен быть корневым
  if (parent.parentId) {
    throw new ValidationError(
      "Нельзя вкладывать глубже двух уровней (подкатегория не может иметь подкатегорий)",
    );
  }
  return parent._id;
}

/** Список страниц текущей клиники. filters: { status? } */
export async function listCustomPages(filters = {}) {
  const q = {};
  if (filters.status) q.status = filters.status;
  const items = await ClinicCustomPage.find(q)
    .sort({ order: 1, createdAt: 1 })
    .lean();
  return items;
}

/** Одна страница по id (в рамках клиники). */
export async function getCustomPage(pageId) {
  const page = await ClinicCustomPage.findById(pageId).lean();
  if (!page) throw new NotFoundError("CustomPage");
  return page;
}

/** Создать страницу. Проверка уникальности slug в клинике. */
export async function createCustomPage(data) {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ValidationError("No clinic context");

  const slug = normalizeSlug(data.slug || data.title);
  if (!slug) throw new ValidationError("slug or title is required");

  const exists = await ClinicCustomPage.findOne({ clinicId, slug })
    .select("_id")
    .lean();
  if (exists) {
    throw new ConflictError(`Page with slug "${slug}" already exists`, {
      field: "slug",
    });
  }

  const parentId = await resolveParentId(data.parentId, clinicId);

  const page = await ClinicCustomPage.create({
    ...data,
    clinicId,
    slug,
    parentId,
  });
  return page.toObject();
}

/** Обновить страницу. При смене slug — проверка уникальности. */
export async function updateCustomPage(pageId, updates) {
  const page = await ClinicCustomPage.findById(pageId);
  if (!page) throw new NotFoundError("CustomPage");

  if (updates.slug !== undefined || updates.title !== undefined) {
    const nextSlug = normalizeSlug(updates.slug || updates.title || page.slug);
    if (nextSlug && nextSlug !== page.slug) {
      const clash = await ClinicCustomPage.findOne({
        clinicId: page.clinicId,
        slug: nextSlug,
        _id: { $ne: page._id },
      })
        .select("_id")
        .lean();
      if (clash) {
        throw new ConflictError(`Page with slug "${nextSlug}" already exists`, {
          field: "slug",
        });
      }
      page.slug = nextSlug;
    }
  }

  // смена родителя (двухуровневая иерархия)
  if (updates.parentId !== undefined) {
    const nextParent = await resolveParentId(
      updates.parentId,
      page.clinicId,
      page._id,
    );
    // если у этой страницы есть СВОИ подкатегории — её нельзя делать подкатегорией
    if (nextParent) {
      const hasChildren = await ClinicCustomPage.exists({
        clinicId: page.clinicId,
        parentId: page._id,
      });
      if (hasChildren) {
        throw new ValidationError(
          "У этой категории есть подкатегории — её нельзя сделать подкатегорией",
        );
      }
    }
    page.parentId = nextParent;
  }

  // применяем остальные поля (slug и parentId уже обработаны выше)
  const { slug, parentId, ...rest } = updates;
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) page[k] = v;
  }

  await page.save();
  return page.toObject();
}

/** Тумблер публикации. */
export async function setCustomPagePublished(pageId, status) {
  const page = await ClinicCustomPage.findById(pageId);
  if (!page) throw new NotFoundError("CustomPage");
  page.status = status;
  await page.save();
  return page.toObject();
}

/** Soft-delete страницы. Дети открепляются (становятся корневыми), не теряются. */
export async function removeCustomPage(pageId) {
  const page = await ClinicCustomPage.findById(pageId);
  if (!page) throw new NotFoundError("CustomPage");
  // открепляем подкатегории, чтобы не осталось сирот со ссылкой на удалённого родителя
  await ClinicCustomPage.updateMany(
    { clinicId: page.clinicId, parentId: page._id },
    { $set: { parentId: null } },
  );
  await page.softDelete(); // из softDeletePlugin
  return { id: String(page._id), deleted: true };
}
