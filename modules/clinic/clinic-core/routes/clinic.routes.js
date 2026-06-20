// modules/clinic/clinic-core/routes/clinic.routes.js

import express from "express";
import * as ctrl from "../controllers/clinic.controller.js";

const router = express.Router();

// POST /clinics — create new clinic (auto-owner)
router.post("/clinics", ctrl.createClinic);

// GET /clinics/me — current user's clinic
router.get("/clinics/me", ctrl.getMyClinic);

// PATCH /clinics/:id/publish — тумблер публикации (этап A).
// Специфичный роут объявлен ДО параметризованного /clinics/:id.
router.patch("/clinics/:id/publish", ctrl.setClinicPublished);

// PATCH /clinics/:id — update clinic (incl. brand fields: description/logo/gallery)
router.patch("/clinics/:id", ctrl.updateClinic);

// GET /public/:slug — LEGACY public clinic page (см. comment в контроллере)
router.get("/public/:slug", ctrl.getPublicClinic);

export default router;
