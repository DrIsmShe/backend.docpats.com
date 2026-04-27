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
   Все роуты модуля под auth. Никаких публичных endpoints.
   ────────────────────────────────────────────────────────────────────────── */
router.use(requireAuth);

/* ──────────────────────────────────────────────────────────────────────────
   PHOTOS — upload для последующего create плана.
   POST /api/simulation/photos
   ────────────────────────────────────────────────────────────────────────── */
router.post(
  "/photos",
  uploadSinglePhoto,
  handleUploadErrors, // ловит multer-ошибки до controller'а
  uploadPhotoController,
);

/* ──────────────────────────────────────────────────────────────────────────
   PLANS — список и создание.
   GET  /api/simulation/plans
   POST /api/simulation/plans
   ────────────────────────────────────────────────────────────────────────── */
router.get("/plans", validateQuery(listPlansQuerySchema), listPlansController);

router.post("/plans", validate(createPlanSchema), createPlanController);

/* ──────────────────────────────────────────────────────────────────────────
   PLANS/:id/duplicate — ДО общего /:id, иначе перехват.
   Помним из security-audit: "Express route registration order matters".
   ────────────────────────────────────────────────────────────────────────── */
router.post(
  "/plans/:id/duplicate",
  validateParams(planIdParamSchema),
  validate(duplicatePlanSchema),
  duplicatePlanController,
);

/* ──────────────────────────────────────────────────────────────────────────
   PLANS/:id/landmarks — S.7 automated anatomical landmarks.
   Регистрируется ДО общего /plans/:id чтобы избежать перехвата.
   PUT    — сохранить (468 точек или [])
   DELETE — очистить
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
