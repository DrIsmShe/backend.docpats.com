// server/modules/clinic/clinic-articles/controllers/clinicArticle.controller.js
//
// CRUD статей клиники (статьи страниц-категорий витрины).
// Запись — домен site_builder/marketing: пускаем marketer (site_builder.write
// ИЛИ marketing.write) наравне с owner/admin (clinic.write). Согласовано с
// clinicCustomPage.controller.js / clinic.controller.js SITE_BUILDER_FIELDS.
// Модерация (рубильник) — отдельный admin-контроллер (см. примечание внизу).

import * as service from "../services/clinicArticle.service.js";
import {
  createArticleSchema,
  updateArticleSchema,
  publishArticleSchema,
} from "../validators/clinicArticle.schemas.js";
import { ForbiddenError } from "../../../../common/utils/errors.js";
import { can } from "../../../../common/auth/can.js";

/**
 * Право на изменение статей витрины.
 * Статьи страниц-категорий — публичный контент витрины (site_builder /
 * marketing), НЕ ядро клиники и НЕ PHI. Write разрешён маркетологу по
 * site_builder.write ИЛИ marketing.write, а также owner/admin по clinic.write.
 */
function assertCanWrite() {
  if (
    !can("site_builder", "write") &&
    !can("marketing", "write") &&
    !can("clinic", "write")
  ) {
    throw new ForbiddenError(
      "site_builder.write, marketing.write or clinic.write permission required",
    );
  }
}

function toListItem(a) {
  return {
    id: String(a._id),
    pageId: String(a.pageId),
    slug: a.slug,
    title: a.title,
    excerpt: a.excerpt || "",
    cover: a.cover || "",
    status: a.status,
    moderation: a.moderation,
    order: a.order ?? 0,
    updatedAt: a.updatedAt,
  };
}

/** GET /api/v1/clinic/articles?pageId=&status= */
export async function listArticles(req, res, next) {
  try {
    const items = await service.listArticles({
      pageId: req.query.pageId,
      status: req.query.status,
    });
    res.json({ items: items.map(toListItem) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/clinic/articles/:id */
export async function getArticle(req, res, next) {
  try {
    const article = await service.getArticle(req.params.id);
    res.json({ article });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/clinic/articles */
export async function createArticle(req, res, next) {
  try {
    assertCanWrite();
    const data = createArticleSchema.parse(req.body);
    const article = await service.createArticle(data);
    res.status(201).json({ article });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/clinic/articles/:id */
export async function updateArticle(req, res, next) {
  try {
    assertCanWrite();
    const updates = updateArticleSchema.parse(req.body);
    const article = await service.updateArticle(req.params.id, updates);
    res.json({ article });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/clinic/articles/:id/publish */
export async function publishArticle(req, res, next) {
  try {
    assertCanWrite();
    const { status } = publishArticleSchema.parse(req.body);
    const article = await service.setArticlePublished(req.params.id, status);
    res.json({ article });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/v1/clinic/articles/:id */
export async function deleteArticle(req, res, next) {
  try {
    assertCanWrite();
    const result = await service.removeArticle(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
