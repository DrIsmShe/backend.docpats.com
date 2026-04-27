import { Router } from "express";
import { z } from "zod";
import * as auditController from "../controllers/audit.controller.js";
import extractActor from "../middleware/extractActor.js";
import validate from "../middleware/validate.js";
import { ObjectIdSchema, CaseIdParamsSchema } from "../validators/_shared.js";

import authMiddleware from "../../../common/middlewares/authMiddleware.js";

const router = Router();

/* ============================================================
   AUDIT QUERY SCHEMAS
   ============================================================
   Inline-схемы — они мелкие и используются только тут. */

const auditPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  skip: z.coerce.number().int().min(0).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  action: z.string().optional(),
  userId: ObjectIdSchema.optional(),
});

const userIdParamsSchema = z.object({
  userId: ObjectIdSchema,
});

const resourceParamsSchema = z.object({
  resourceType: z.enum(["PatientCase", "Study", "Photo", "Annotation"]),
  resourceId: ObjectIdSchema,
});

/* ============================================================
   ROUTES
   ============================================================ */

/* GET /audit/cases/:caseId */
router.get(
  "/cases/:caseId",
  authMiddleware,
  extractActor,
  validate(CaseIdParamsSchema, "params"),
  validate(auditPaginationSchema, "query"),
  auditController.getCaseHistory,
);

/* GET /audit/users/:userId */
router.get(
  "/users/:userId",
  authMiddleware,
  extractActor,
  validate(userIdParamsSchema, "params"),
  validate(auditPaginationSchema, "query"),
  auditController.getUserActivity,
);

/* GET /audit/denied */
router.get(
  "/denied",
  authMiddleware,
  extractActor,
  validate(auditPaginationSchema, "query"),
  auditController.getDeniedAttempts,
);

/* GET /audit/resources/:resourceType/:resourceId/viewers */
router.get(
  "/resources/:resourceType/:resourceId/viewers",
  authMiddleware,
  extractActor,
  validate(resourceParamsSchema, "params"),
  validate(auditPaginationSchema, "query"),
  auditController.getResourceViewers,
);

export default router;
