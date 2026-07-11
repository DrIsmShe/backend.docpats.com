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
import { submitLead } from "../clinic-leads/controllers/lead.controller.js";
const router = express.Router();
// GET /api/v1/public/theme-presets вЂ” СЃР»РѕРІР°СЂРё С‚РµРј РІРёС‚СЂРёРЅС‹ (СЃС‚Р°С‚РёС‡РЅС‹Рµ, РєРµС€РёСЂСѓРµРјС‹Рµ)
router.get("/theme-presets", getThemePresets);
// GET /api/v1/public/clinics/:slug
router.get("/clinics/:slug", getPublicClinicController);
router.get("/clinics/:slug/pages/:pageSlug", getPublicCustomPageHandler);
// в†’ GET /api/v1/public/clinics/:slug/pages/:pageSlug
router.get("/clinics/:slug/dp/:pageSlug/articles", listCategoryArticlesHandler);
router.get(
  "/clinics/:slug/dp/:pageSlug/articles/:articleSlug",
  getArticleDetailHandler,
);
// Р°РіСЂРµРіР°С‚ СЃС‚Р°С‚РµР№ РІСЃРµС… РїРѕРґРєР°С‚РµРіРѕСЂРёР№ СЂРѕРґРёС‚РµР»СЏ (Р§Р°СЃС‚СЊ 6)
router.get(
  "/clinics/:slug/dp/:pageSlug/all-articles",
  listParentArticlesHandler,
);
router.get("/clinics/:slug/dp/:pageSlug/gallery", listCategoryGalleryHandler);
// POST /api/v1/public/clinics/:slug/leads — visitor contact form
router.post("/clinics/:slug/leads", submitLead);

export default router;
