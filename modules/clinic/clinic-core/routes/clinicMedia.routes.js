// modules/clinic/clinic-core/routes/clinicMedia.routes.js
//
// Clinic-as-Brand (этап B) + ВИТРИНА 2.0 (V4) — роуты медиа клиники
// (логотип + обложка + галерея). Монтируются в clinic-core роутере →
// под tenantMiddleware.
//
// ⚠ ALS + multer: multer-стримы рвут AsyncLocalStorage-контекст. После
// upload.* контекст восстанавливаем через req.tenantContext snapshot
// (тот же паттерн, что в clinic-medical/imaging.routes.js).

import express from "express";
import { runWithTenantContext } from "../../../../common/context/tenantContext.js";
import { upload } from "../../../../common/middlewares/uploadMiddleware.js";
import * as media from "../controllers/clinicMedia.controller.js";

const router = express.Router();

/**
 * Re-bind ALS tenant context lost in multer's stream pipeline.
 * Place AFTER upload.*, BEFORE the controller.
 */
function rebindTenantContext(req, res, next) {
  const ctx = req.tenantContext;
  if (!ctx) return next();
  runWithTenantContext(ctx, () => next());
}

// ─── LOGO ───────────────────────────────────────────────────────────
// POST /api/v1/clinic/clinics/:id/logo   (multipart, field "logo")
router.post(
  "/clinics/:id/logo",
  upload.single("logo"),
  rebindTenantContext,
  media.uploadClinicLogo,
);

// DELETE /api/v1/clinic/clinics/:id/logo
router.delete("/clinics/:id/logo", media.deleteClinicLogo);

// ─── COVER (ВИТРИНА 2.0 V4: обложка hero) ───────────────────────────
// POST /api/v1/clinic/clinics/:id/cover   (multipart, field "cover")
router.post(
  "/clinics/:id/cover",
  upload.single("cover"),
  rebindTenantContext,
  media.uploadClinicCover,
);

// DELETE /api/v1/clinic/clinics/:id/cover
router.delete("/clinics/:id/cover", media.deleteClinicCover);

// ─── PAGE BACKGROUND (ВИТРИНА 2.0: фон всей страницы) ───────────────
// POST /api/v1/clinic/clinics/:id/page-bg   (multipart, field "pageBg")
router.post(
  "/clinics/:id/page-bg",
  upload.single("pageBg"),
  rebindTenantContext,
  media.uploadClinicPageBg,
);

// DELETE /api/v1/clinic/clinics/:id/page-bg
router.delete("/clinics/:id/page-bg", media.deleteClinicPageBg);

// ─── GENERIC ASSET (ВИТРИНА 2.0 Путь 1: баннеры страниц и пр.) ──────
// POST /api/v1/clinic/clinics/:id/asset   (multipart, field "asset")
// Грузит картинку в R2, возвращает { url }. URL хранит фронт в config блока.
router.post(
  "/clinics/:id/asset",
  upload.single("asset"),
  rebindTenantContext,
  media.uploadClinicAsset,
);

// ─── GALLERY ────────────────────────────────────────────────────────
// POST /api/v1/clinic/clinics/:id/gallery   (multipart, field "images")
router.post(
  "/clinics/:id/gallery",
  upload.array("images", 20),
  rebindTenantContext,
  media.uploadClinicGallery,
);

// DELETE /api/v1/clinic/clinics/:id/gallery/:itemId
router.delete("/clinics/:id/gallery/:itemId", media.deleteClinicGalleryItem);

export default router;
