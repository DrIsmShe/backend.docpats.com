import { Router } from "express";
import * as annotationController from "../controllers/annotation.controller.js";
import extractActor from "../middleware/extractActor.js";
import validate from "../middleware/validate.js";
import {
  createAnnotationSchema,
  annotationByPresetQuerySchema,
  updateLandmarksSchema,
  createNewVersionSchema,
  lockAnnotationSchema,
  unlockAnnotationSchema,
  deleteAnnotationSchema,
} from "../validators/annotation.validator.js";
import {
  PhotoIdParamsSchema,
  AnnotationIdParamsSchema,
} from "../validators/_shared.js";

import authMiddleware from "../../../common/middlewares/authMiddleware.js";

const router = Router();

/* ============================================================
   POST /photos/:photoId/annotations (создание v1)
   ============================================================ */
router.post(
  "/photos/:photoId/annotations",
  authMiddleware,
  extractActor,
  validate(PhotoIdParamsSchema, "params"),
  validate(createAnnotationSchema, "body"),
  annotationController.createAnnotation,
);

/* ============================================================
   GET /photos/:photoId/annotations/current?presetType=...
   ============================================================ */
router.get(
  "/photos/:photoId/annotations/current",
  authMiddleware,
  extractActor,
  validate(PhotoIdParamsSchema, "params"),
  validate(annotationByPresetQuerySchema, "query"),
  annotationController.getCurrentForPhoto,
);

/* ============================================================
   GET /photos/:photoId/annotations/history?presetType=...
   ============================================================ */
router.get(
  "/photos/:photoId/annotations/history",
  authMiddleware,
  extractActor,
  validate(PhotoIdParamsSchema, "params"),
  validate(annotationByPresetQuerySchema, "query"),
  annotationController.getHistory,
);

/* ============================================================
   POST /photos/:photoId/annotations/version (новая версия)
   ============================================================ */
router.post(
  "/photos/:photoId/annotations/version",
  authMiddleware,
  extractActor,
  validate(PhotoIdParamsSchema, "params"),
  validate(createNewVersionSchema, "body"),
  annotationController.createNewVersion,
);

/* ============================================================
   GET /annotations/:annotationId
   ============================================================ */
router.get(
  "/annotations/:annotationId",
  authMiddleware,
  extractActor,
  validate(AnnotationIdParamsSchema, "params"),
  annotationController.getAnnotation,
);

/* ============================================================
   PATCH /annotations/:annotationId (обновить landmarks)
   ============================================================ */
router.patch(
  "/annotations/:annotationId",
  authMiddleware,
  extractActor,
  validate(AnnotationIdParamsSchema, "params"),
  validate(updateLandmarksSchema, "body"),
  annotationController.updateLandmarks,
);

/* ============================================================
   POST /annotations/:annotationId/lock
   ============================================================ */
router.post(
  "/annotations/:annotationId/lock",
  authMiddleware,
  extractActor,
  validate(AnnotationIdParamsSchema, "params"),
  validate(lockAnnotationSchema, "body"),
  annotationController.lockAnnotation,
);

/* ============================================================
   POST /annotations/:annotationId/unlock
   ============================================================ */
router.post(
  "/annotations/:annotationId/unlock",
  authMiddleware,
  extractActor,
  validate(AnnotationIdParamsSchema, "params"),
  validate(unlockAnnotationSchema, "body"),
  annotationController.unlockAnnotation,
);

/* ============================================================
   DELETE /annotations/:annotationId
   ============================================================ */
router.delete(
  "/annotations/:annotationId",
  authMiddleware,
  extractActor,
  validate(AnnotationIdParamsSchema, "params"),
  validate(deleteAnnotationSchema, "body"),
  annotationController.softDeleteAnnotation,
);

export default router;
