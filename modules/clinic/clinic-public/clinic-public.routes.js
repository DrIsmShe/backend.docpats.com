// server/modules/clinic/clinic-public/clinic-public.routes.js
//
// Clinic-as-Brand (этап A) — публичный роутер.
//
// Монтируется на КОРНЕ приложения: app.use("/api/v1/public", clinicPublicRouter)
// → итоговый путь GET /api/v1/public/clinics/:slug
//
// БЕЗ authMiddleware, БЕЗ tenantMiddleware — гость/потенциальный пациент.

import express from "express";
import { getPublicClinicController } from "./clinic-public.controller.js";

const router = express.Router();

// GET /api/v1/public/clinics/:slug
router.get("/clinics/:slug", getPublicClinicController);

export default router;
