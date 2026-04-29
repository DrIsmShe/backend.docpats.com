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
  updatePlanSchema,
  duplicatePlanSchema,
  listPlansQuerySchema,
  planIdParamSchema,
} from "../validators/simulationPlan.validator.js";

import { uploadPhotoController } from "../controllers/uploadPhotoController.js";
import { photoProxyController } from "../controllers/photoProxyController.js";
import { createPlanController } from "../controllers/createPlanController.js";
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
     POST /api/simulation/photos          — upload
     GET  /api/simulation/photos/proxy    — S.7.7+ proxy для obхода CDN
                                            propagation. Регистрируется ДО
                                            POST чтобы избежать конфликта
                                            (Express всё равно различает
                                            методы, но порядок безопаснее).
   ────────────────────────────────────────────────────────────────────────── */
router.get("/photos/proxy", photoProxyController);

router.post(
  "/photos",
  uploadSinglePhoto,
  handleUploadErrors,
  uploadPhotoController,
);

/* ──────────────────────────────────────────────────────────────────────────
   PLANS — список и создание.
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
   PLANS/:id/landmarks
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
