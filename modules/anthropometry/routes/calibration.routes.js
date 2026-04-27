import { Router } from "express";
import * as calibrationController from "../controllers/calibration.controller.js";
import extractActor from "../middleware/extractActor.js";
import validate from "../middleware/validate.js";
import {
  calibrateRulerSchema,
  calibrateInterpupillarySchema,
  recalibrateSchema,
} from "../validators/calibration.validator.js";
import { StudyIdParamsSchema } from "../validators/_shared.js";

import authMiddleware from "../../../common/middlewares/authMiddleware.js";

/* ============================================================
   CALIBRATION ROUTES
   ============================================================
   Все пути под /studies/:studyId/... */

const router = Router();

/* POST /studies/:studyId/calibrate/ruler */
router.post(
  "/studies/:studyId/calibrate/ruler",
  authMiddleware,
  extractActor,
  validate(StudyIdParamsSchema, "params"),
  validate(calibrateRulerSchema, "body"),
  calibrationController.calibrateWithRuler,
);

/* POST /studies/:studyId/calibrate/interpupillary */
router.post(
  "/studies/:studyId/calibrate/interpupillary",
  authMiddleware,
  extractActor,
  validate(StudyIdParamsSchema, "params"),
  validate(calibrateInterpupillarySchema, "body"),
  calibrationController.calibrateWithInterpupillary,
);

/* POST /studies/:studyId/recalibrate */
router.post(
  "/studies/:studyId/recalibrate",
  authMiddleware,
  extractActor,
  validate(StudyIdParamsSchema, "params"),
  validate(recalibrateSchema, "body"),
  calibrationController.recalibrate,
);

/* GET /studies/:studyId/calibration */
router.get(
  "/studies/:studyId/calibration",
  authMiddleware,
  extractActor,
  validate(StudyIdParamsSchema, "params"),
  calibrationController.getCalibrationInfo,
);

/* DELETE /studies/:studyId/calibration */
router.delete(
  "/studies/:studyId/calibration",
  authMiddleware,
  extractActor,
  validate(StudyIdParamsSchema, "params"),
  calibrationController.uncalibrate,
);

export default router;
