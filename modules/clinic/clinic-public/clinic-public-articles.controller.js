// server/modules/clinic/clinic-public/clinic-public-articles.controller.js
//
// ВИТРИНА 2.0 (Часть 3) — публичная отдача статей клиники (без авторизации).
// Видны только опубликованные и не заблокированные проектом (фильтр в сервисе).
//
// Маршруты (добавить в публичный роутер clinic-public):
//   GET /clinics/:slug/dp/:pageSlug/articles            → список карточек
//   GET /clinics/:slug/dp/:pageSlug/articles/:articleSlug → детейл
// Полные пути: /api/v1/public/clinics/:slug/dp/:pageSlug/articles[/:articleSlug]

import {
  getPublicCategoryArticles,
  getPublicArticleDetail,
  getPublicParentArticles,
} from "./clinic-public.service.js";

// ВИТРИНА 2.0 (Часть 6) — агрегат статей всех подкатегорий родителя.
// GET /clinics/:slug/dp/:pageSlug/all-articles
export async function listParentArticlesHandler(req, res, next) {
  try {
    const { slug, pageSlug } = req.params;
    const data = await getPublicParentArticles(slug, pageSlug);
    if (data === null) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.set("Cache-Control", "public, max-age=120");
    res.json(data); // { articles:[...], subcategories:[...] }
  } catch (err) {
    next(err);
  }
}

export async function listCategoryArticlesHandler(req, res, next) {
  try {
    const { slug, pageSlug } = req.params;
    const items = await getPublicCategoryArticles(slug, pageSlug);
    if (items === null) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.set("Cache-Control", "public, max-age=120");
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

export async function getArticleDetailHandler(req, res, next) {
  try {
    const { slug, pageSlug, articleSlug } = req.params;
    const article = await getPublicArticleDetail(slug, pageSlug, articleSlug);
    if (!article) {
      return res.status(404).json({ error: "Article not found" });
    }
    res.set("Cache-Control", "public, max-age=120");
    res.json(article); // { slug, title, body, ... , category }
  } catch (err) {
    next(err);
  }
}
