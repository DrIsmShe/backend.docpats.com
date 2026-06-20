// modules/clinic/clinic-core/routes/clinicMedia.routes.js
//
// Clinic-as-Brand (этап B) — роуты медиа клиники (логотип + галерея).
// Монтируются в clinic-core роутере → под tenantMiddleware.
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
