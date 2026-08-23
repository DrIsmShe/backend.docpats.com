import express from "express";
import {
  getPublicClinicController,
  getPublicClinicDoctorController,
  getPublicClinicPublicationController,
  getPublicDoctorSlotsController,
  createPublicBookingController,
} from "./clinic-public.controller.js";
import { getThemePresets } from "./theme-presets.controller.js";
import { getPublicCustomPageHandler } from "./clinic-public-pages.controller.js";
import {
  listCategoryArticlesHandler,
  getArticleDetailHandler,
  listParentArticlesHandler,
} from "./clinic-public-articles.controller.js";
import { listCategoryGalleryHandler } from "./clinic-public-gallery.controller.js";
import { submitLead } from "../clinic-leads/controllers/lead.controller.js";
import {
  publicLeadLimiter,
  publicBookingLimiter,
} from "../../../common/middlewares/rateLimiter.js";
const router = express.Router();
// GET /api/v1/public/theme-presets вЂ” СЃР»РѕРІР°СЂРё С‚РµРј РІРёС‚СЂРёРЅС‹ (СЃС‚Р°С‚РёС‡РЅС‹Рµ, РєРµС€РёСЂСѓРµРјС‹Рµ)
router.get("/theme-presets", getThemePresets);
// GET /api/v1/public/clinics/:slug
router.get("/clinics/:slug", getPublicClinicController);
// Врач и публикация ВНУТРИ витрины: те же данные, что на страницах
// платформы, но по адресу клиники и с проверкой принадлежности ей.
router.get("/clinics/:slug/doctors/:doctorId", getPublicClinicDoctorController);
router.get("/clinics/:slug/publications/:id", getPublicClinicPublicationController);
// Запись с витрины: свободное время врача и заявка на приём.
router.get(
  "/clinics/:slug/doctors/:doctorId/slots",
  getPublicDoctorSlotsController,
);
router.post(
  "/clinics/:slug/doctors/:doctorId/booking",
  publicBookingLimiter,
  createPublicBookingController,
);
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
// Единственный публичный маршрут, который ПИШЕТ в базу, и каждая запись
// рассылает письмо и уведомления. Лимитер здесь обязателен.
router.post("/clinics/:slug/leads", publicLeadLimiter, submitLead);

export default router;
