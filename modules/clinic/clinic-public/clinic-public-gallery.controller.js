// server/modules/clinic/clinic-public/clinic-public-gallery.controller.js
//
// ВИТРИНА 2.0 (Часть 4) — публичная отдача галереи категории (без авторизации).
//
// Маршрут (добавить в публичный роутер clinic-public):
//   GET /clinics/:slug/dp/:pageSlug/gallery
// Полный путь: /api/v1/public/clinics/:slug/dp/:pageSlug/gallery

import { getPublicCategoryGallery } from "./clinic-public.service.js";

export async function listCategoryGalleryHandler(req, res, next) {
  try {
    const { slug, pageSlug } = req.params;
    const items = await getPublicCategoryGallery(slug, pageSlug);
    if (items === null) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.set("Cache-Control", "public, max-age=120");
    res.json({ items });
  } catch (err) {
    next(err);
  }
}
