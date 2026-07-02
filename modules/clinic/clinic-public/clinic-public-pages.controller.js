// server/modules/clinic/clinic-public/clinic-public-pages.controller.js
//
// ВИТРИНА 2.0 (Часть 2) — публичная отдача контента кастомной страницы.
// Без авторизации (как остальные /public/clinics/* эндпоинты).
//
// Маршрут (добавить в публичный роутер clinic-public):
//   router.get("/clinics/:slug/pages/:pageSlug", getPublicCustomPageHandler);
// Полный путь: GET /api/v1/public/clinics/:slug/pages/:pageSlug
//
// Фронт обращается сюда при открытии /clinics/:slug/dp/:pageSlug.

import { getPublicCustomPage } from "./clinic-public.service.js";

export async function getPublicCustomPageHandler(req, res, next) {
  try {
    const { slug, pageSlug } = req.params;
    const page = await getPublicCustomPage(slug, pageSlug);
    if (!page) {
      return res.status(404).json({ error: "Page not found" });
    }
    // Контент страницы статичен между правками — мягкий кэш.
    res.set("Cache-Control", "public, max-age=120");
    res.json(page); // { slug, title, seo, layout:{blocks} }
  } catch (err) {
    next(err);
  }
}
