// modules/clinic/clinic-core/routes/clinic.routes.js

import express from "express";
import * as ctrl from "../controllers/clinic.controller.js";
import customPageRoutes from "../../clinic-pages/routes/clinicCustomPage.routes.js";
import articleRoutes from "../../clinic-articles/routes/clinicArticle.routes.js";
import galleryRoutes from "../../clinic-gallery/routes/clinicGalleryItem.routes.js";
const router = express.Router();

// POST /clinics — create new clinic (auto-owner)
router.post("/clinics", ctrl.createClinic);

// GET /clinics/me — current user's clinic
router.get("/clinics/me", ctrl.getMyClinic);

// PATCH /clinics/:id/publish — тумблер публикации (этап A).
router.patch("/clinics/:id/publish", ctrl.setClinicPublished);

// PATCH /clinics/:id — update clinic
router.patch("/clinics/:id", ctrl.updateClinic);

// GET /public/:slug — LEGACY public clinic page
router.get("/public/:slug", ctrl.getPublicClinic);

// ВИТРИНА 2.0 (Часть 2) — кастомные страницы: /pages...
router.use(customPageRoutes);
router.use(articleRoutes);
router.use(galleryRoutes);
export default router;
