import { Router } from "express";

import caseRouter from "./case.routes.js";
import studyRouter from "./study.routes.js";
import calibrationRouter from "./calibration.routes.js";
import photoRouter from "./photo.routes.js";
import annotationRouter from "./annotation.routes.js";
import auditRouter from "./audit.routes.js";

import handleErrors from "../middleware/handleErrors.js";

/* ============================================================
   ANTHROPOMETRY MODULE — MAIN ROUTER
   ============================================================
   Подключается в главном server/index.js под префиксом
   /api/anthropometry.

   Все sub-роутеры монтируются на корень "/" — пути в них
   уже содержат префиксы (cases, studies, photos, и т.д.).

   handleErrors — В САМОМ КОНЦЕ. Express ловит ошибки только
   из middleware/роутов, зарегистрированных ДО error handler.
   ============================================================ */

const router = Router();

// CASE ROUTES — /api/anthropometry/cases/...
router.use("/cases", caseRouter);

// STUDY ROUTES — /api/anthropometry/cases/:caseId/studies/...
//                /api/anthropometry/studies/:studyId/...
router.use("/", studyRouter);

// CALIBRATION ROUTES — /api/anthropometry/studies/:studyId/calibrate/...
router.use("/", calibrationRouter);

// PHOTO ROUTES — /api/anthropometry/studies/:studyId/photos
//                /api/anthropometry/photos/:photoId/...
router.use("/", photoRouter);

// ANNOTATION ROUTES — /api/anthropometry/photos/:photoId/annotations/...
//                     /api/anthropometry/annotations/:annotationId/...
router.use("/", annotationRouter);

// AUDIT ROUTES — /api/anthropometry/audit/...
router.use("/audit", auditRouter);

// ============================================================
// ERROR HANDLER — должен быть В САМОМ КОНЦЕ
// ============================================================
router.use(handleErrors);

export default router;
