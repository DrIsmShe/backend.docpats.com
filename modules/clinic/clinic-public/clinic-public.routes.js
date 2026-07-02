import express from "express";
import { getPublicClinicController } from "./clinic-public.controller.js";
import { getThemePresets } from "./theme-presets.controller.js";
import { getPublicCustomPageHandler } from "./clinic-public-pages.controller.js";
import {
  listCategoryArticlesHandler,
  getArticleDetailHandler,
  listParentArticlesHandler,
} from "./clinic-public-articles.controller.js";
import { listCategoryGalleryHandler } from "./clinic-public-gallery.controller.js";
const router = express.Router();
// GET /api/v1/public/theme-presets — словари тем витрины (статичные, кешируемые)
router.get("/theme-presets", getThemePresets);
// GET /api/v1/public/clinics/:slug
router.get("/clinics/:slug", getPublicClinicController);
router.get("/clinics/:slug/pages/:pageSlug", getPublicCustomPageHandler);
// → GET /api/v1/public/clinics/:slug/pages/:pageSlug
router.get("/clinics/:slug/dp/:pageSlug/articles", listCategoryArticlesHandler);
router.get(
  "/clinics/:slug/dp/:pageSlug/articles/:articleSlug",
  getArticleDetailHandler,
);
// агрегат статей всех подкатегорий родителя (Часть 6)
router.get(
  "/clinics/:slug/dp/:pageSlug/all-articles",
  listParentArticlesHandler,
);
router.get("/clinics/:slug/dp/:pageSlug/gallery", listCategoryGalleryHandler);
export default router;
