import { Router } from "express";
import * as caseController from "../controllers/case.controller.js";
import extractActor from "../middleware/extractActor.js";
import validate from "../middleware/validate.js";
import {
  createCaseSchema,
  listCasesQuerySchema,
  updateCaseSchema,
  giveConsentSchema,
  archiveCaseSchema,
  deleteCaseSchema,
} from "../validators/case.validator.js";
import { CaseIdParamsSchema } from "../validators/_shared.js";

// !!! ЗАМЕНИ ПУТЬ ПОД СВОЙ ПРОЕКТ:
import authMiddleware from "../../../common/middlewares/authMiddleware.js";

/* ============================================================
   CASE ROUTES
   ============================================================
   Базовый префикс /api/anthropometry/cases (определяется
   в routes/index.js при подключении этого router-а). */

const router = Router();

/* ============================================================
   POST /cases
   ============================================================ */
router.post(
  "/",
  authMiddleware,
  extractActor,
  validate(createCaseSchema, "body"),
  caseController.createCase,
);

/* ============================================================
   GET /cases
   ============================================================ */
router.get(
  "/",
  authMiddleware,
  extractActor,
  validate(listCasesQuerySchema, "query"),
  caseController.listCases,
);

/* ============================================================
   GET /cases/:caseId
   ============================================================ */
router.get(
  "/:caseId",
  authMiddleware,
  extractActor,
  validate(CaseIdParamsSchema, "params"),
  caseController.getCase,
);

/* ============================================================
   PATCH /cases/:caseId
   ============================================================ */
router.patch(
  "/:caseId",
  authMiddleware,
  extractActor,
  validate(CaseIdParamsSchema, "params"),
  validate(updateCaseSchema, "body"),
  caseController.updateCase,
);

/* ============================================================
   POST /cases/:caseId/consent
   ============================================================ */
router.post(
  "/:caseId/consent",
  authMiddleware,
  extractActor,
  validate(CaseIdParamsSchema, "params"),
  validate(giveConsentSchema, "body"),
  caseController.giveConsent,
);

/* ============================================================
   POST /cases/:caseId/archive
   ============================================================ */
router.post(
  "/:caseId/archive",
  authMiddleware,
  extractActor,
  validate(CaseIdParamsSchema, "params"),
  validate(archiveCaseSchema, "body"),
  caseController.archiveCase,
);

/* ============================================================
   POST /cases/:caseId/unarchive
   ============================================================ */
router.post(
  "/:caseId/unarchive",
  authMiddleware,
  extractActor,
  validate(CaseIdParamsSchema, "params"),
  caseController.unarchiveCase,
);

/* ============================================================
   DELETE /cases/:caseId
   ============================================================ */
router.delete(
  "/:caseId",
  authMiddleware,
  extractActor,
  validate(CaseIdParamsSchema, "params"),
  validate(deleteCaseSchema, "body"),
  caseController.softDeleteCase,
);

export default router;
