// server/modules/simulation/routes/simulation.routes.js
import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";
import {
  uploadSinglePhoto,
  handleUploadErrors,
} from "../middleware/upload.middleware.js";

import {
  validate,
  validateParams,
  validateQuery,
  createPlanSchema,
  createBreastPlanSchema, // S.8
  updatePlanSchema,
  duplicatePlanSchema,
  listPlansQuerySchema,
  planIdParamSchema,
} from "../validators/simulationPlan.validator.js";

import { uploadPhotoController } from "../controllers/uploadPhotoController.js";
import { photoProxyController } from "../controllers/photoProxyController.js";
import { createPlanController } from "../controllers/createPlanController.js";
// S.8 — breast controllers
import { createBreastPlanController } from "../controllers/createBreastPlanController.js";
import { listBreastGroupedController } from "../controllers/listBreastGroupedController.js";

import { listPlansController } from "../controllers/listPlansController.js";
import { getPlanController } from "../controllers/getPlanController.js";
import { updatePlanController } from "../controllers/updatePlanController.js";
import { deletePlanController } from "../controllers/deletePlanController.js";
import { duplicatePlanController } from "../controllers/duplicatePlanController.js";

import {
  putLandmarksController,
  deleteLandmarksController,
} from "../controllers/landmarksController.js";

const router = Router();

/* ──────────────────────────────────────────────────────────────────────────
   Все роуты модуля под auth.
   ────────────────────────────────────────────────────────────────────────── */
router.use(requireAuth);

/* ──────────────────────────────────────────────────────────────────────────
   PHOTOS
     POST /api/simulation/photos          — upload (face и breast одинаково)
     GET  /api/simulation/photos/proxy    — S.7.7+ proxy
   ────────────────────────────────────────────────────────────────────────── */
router.get("/photos/proxy", photoProxyController);

router.post(
  "/photos",
  uploadSinglePhoto,
  handleUploadErrors,
  uploadPhotoController,
);

/* ──────────────────────────────────────────────────────────────────────────
   S.8 — BREAST (специфичные endpoints — ДО общих /plans/...).

   POST /api/simulation/plans/breast        — создание breast plan
   GET  /api/simulation/breast/grouped      — группировка по пациенту

   Note: список breast и обычный get/update/delete идут через общие
   /plans endpoints с фильтром planType=breast в query.
   ────────────────────────────────────────────────────────────────────────── */
router.post(
  "/plans/breast",
  validate(createBreastPlanSchema),
  createBreastPlanController,
);

router.get("/breast/grouped", listBreastGroupedController);

/* ──────────────────────────────────────────────────────────────────────────
   PLANS — список и создание (face).
   GET /plans поддерживает ?planType=face|breast для фильтрации.
   ────────────────────────────────────────────────────────────────────────── */
router.get("/plans", validateQuery(listPlansQuerySchema), listPlansController);

router.post("/plans", validate(createPlanSchema), createPlanController);

/* ──────────────────────────────────────────────────────────────────────────
   PLANS/:id/duplicate — ДО общего /:id, иначе перехват.
   ────────────────────────────────────────────────────────────────────────── */
router.post(
  "/plans/:id/duplicate",
  validateParams(planIdParamSchema),
  validate(duplicatePlanSchema),
  duplicatePlanController,
);

/* ──────────────────────────────────────────────────────────────────────────
   PLANS/:id/landmarks (face only — для breast не используется)
   ────────────────────────────────────────────────────────────────────────── */
router.put(
  "/plans/:id/landmarks",
  validateParams(planIdParamSchema),
  putLandmarksController,
);

router.delete(
  "/plans/:id/landmarks",
  validateParams(planIdParamSchema),
  deleteLandmarksController,
);

/* ──────────────────────────────────────────────────────────────────────────
   PLANS/:id — get/update/delete.
   updatePlanSchema теперь поддерживает breast-specific поля
   (anatomy, operation, calibration) опционально.
   ────────────────────────────────────────────────────────────────────────── */
router.get("/plans/:id", validateParams(planIdParamSchema), getPlanController);

router.patch(
  "/plans/:id",
  validateParams(planIdParamSchema),
  validate(updatePlanSchema),
  updatePlanController,
);

router.delete(
  "/plans/:id",
  validateParams(planIdParamSchema),
  deletePlanController,
);

export default router;
