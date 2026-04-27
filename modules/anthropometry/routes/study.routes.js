import { Router } from "express";
import * as studyController from "../controllers/study.controller.js";
import extractActor from "../middleware/extractActor.js";
import validate from "../middleware/validate.js";
import {
  createStudySchema,
  updateStudySchema,
  listStudiesQuerySchema,
  deleteStudySchema,
} from "../validators/study.validator.js";
import {
  CaseIdParamsSchema,
  StudyIdParamsSchema,
} from "../validators/_shared.js";

import authMiddleware from "../../../common/middlewares/authMiddleware.js";

/* ============================================================
   STUDY ROUTES
   ============================================================
   Префикс /api/anthropometry задаётся в routes/index.js.

   Этот router содержит ДВА типа путей:
   - /cases/:caseId/studies/...  (вложенные)
   - /studies/:studyId/...        (прямые)

   Будет смонтирован в routes/index.js дважды для разных
   префиксов, либо подмонтирован под общим префиксом без
   разницы — Express умеет оба пути обрабатывать. */

const router = Router();

/* ============================================================
   POST /cases/:caseId/studies
   ============================================================ */
router.post(
  "/cases/:caseId/studies",
  authMiddleware,
  extractActor,
  validate(CaseIdParamsSchema, "params"),
  validate(createStudySchema, "body"),
  studyController.createStudy,
);

/* ============================================================
   GET /cases/:caseId/studies
   ============================================================ */
router.get(
  "/cases/:caseId/studies",
  authMiddleware,
  extractActor,
  validate(CaseIdParamsSchema, "params"),
  validate(listStudiesQuerySchema, "query"),
  studyController.listStudiesByCase,
);

/* ============================================================
   GET /studies/:studyId
   ============================================================ */
router.get(
  "/studies/:studyId",
  authMiddleware,
  extractActor,
  validate(StudyIdParamsSchema, "params"),
  studyController.getStudy,
);

/* ============================================================
   PATCH /studies/:studyId
   ============================================================ */
router.patch(
  "/studies/:studyId",
  authMiddleware,
  extractActor,
  validate(StudyIdParamsSchema, "params"),
  validate(updateStudySchema, "body"),
  studyController.updateStudy,
);

/* ============================================================
   POST /studies/:studyId/complete
   ============================================================ */
router.post(
  "/studies/:studyId/complete",
  authMiddleware,
  extractActor,
  validate(StudyIdParamsSchema, "params"),
  studyController.completeStudy,
);

/* ============================================================
   DELETE /studies/:studyId
   ============================================================ */
router.delete(
  "/studies/:studyId",
  authMiddleware,
  extractActor,
  validate(StudyIdParamsSchema, "params"),
  validate(deleteStudySchema, "body"),
  studyController.softDeleteStudy,
);

export default router;
