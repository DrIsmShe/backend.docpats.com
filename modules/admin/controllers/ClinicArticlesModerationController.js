// server/modules/admin/controllers/ClinicArticlesModerationController.js
//
// ВИТРИНА 2.0 (Часть 3, Этап 6) — модерация статей клиник ПРОЕКТОМ (admin).
//
// Рубильник: admin проекта может выключить (moderation:"disabled") статью любой
// клиники — она мгновенно скрывается на витрине, даже если клиника опубликовала.
// Клиника решение проекта переопределить не может.
//
// Логика — в сервисе clinic-articles (adminListArticles / setArticleModeration).

import * as service from "../../clinic/clinic-articles/services/clinicArticle.service.js";
import { moderateArticleSchema } from "../../clinic/clinic-articles/validators/clinicArticle.schemas.js";

function toAdminItem(a) {
  return {
    id: String(a._id),
    clinicId: String(a.clinicId),
    pageId: String(a.pageId),
    slug: a.slug,
    title: a.title,
    status: a.status,
    moderation: a.moderation,
    moderationNote: a.moderationNote || "",
    createdAt: a.createdAt,
  };
}

// GET /clinic-articles?clinicId=&moderation=&status=&q=&limit=&skip=
export async function adminListArticles(req, res, next) {
  try {
    const { clinicId, moderation, status, q, limit, skip } = req.query;
    const result = await service.adminListArticles(
      { clinicId, moderation, status, q },
      { limit, skip },
    );
    res.json({
      items: result.items.map(toAdminItem),
      total: result.total,
      limit: result.limit,
      skip: result.skip,
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /clinic-articles/:id/moderation  body:{ moderation, moderationNote? }
export async function adminModerateArticle(req, res, next) {
  try {
    const { moderation, moderationNote } = moderateArticleSchema.parse(
      req.body,
    );
    const article = await service.setArticleModeration(
      req.params.id,
      moderation,
      moderationNote,
    );
    res.json({ article });
  } catch (err) {
    next(err);
  }
}
