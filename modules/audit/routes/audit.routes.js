// modules/audit/routes/audit.routes.js
//
// REST API для compliance / HIPAA audit log.
//
// Все роуты требуют аутентификации.
// Большинство — только для admin / compliance_officer.
//
// Пользователь может смотреть свою активность и кто видел его данные.

import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import extractActor from "../middleware/extractActor.js";
import * as auditController from "../controllers/audit.controller.js";

const router = Router();

/* ═══════════ Все роуты требуют auth + extractActor ═══════════ */
router.use(authMiddleware);
router.use(extractActor);

/* GET /audit/users/:userId
   История действий пользователя.
   Юзер может смотреть только свою активность, админ — любую.
   Query: ?action=&from=&to=&limit=&skip= */
router.get("/users/:userId", auditController.getUserActivity);

/* GET /audit/cases/:caseId
   История по anthropometry-case. Только admin.
   Query: ?action=&limit=&skip= */
router.get("/cases/:caseId", auditController.getCaseHistory);

/* GET /audit/resources/:resourceType/:resourceId
   История одного ресурса. Admin.
   Query: ?action=&limit= */
router.get(
  "/resources/:resourceType/:resourceId",
  auditController.getResourceHistory,
);

/* GET /audit/resources/:resourceType/:resourceId/viewers
   Кто смотрел этот ресурс. Admin.
   Query: ?limit= */
router.get(
  "/resources/:resourceType/:resourceId/viewers",
  auditController.getResourceViewers,
);

/* GET /audit/owners/:ownerId
   Кто работал с PHI этого пациента/пользователя.
   Сам пользователь или admin.
   Query: ?from=&to=&limit= */
router.get("/owners/:ownerId", auditController.getOwnerHistory);

/* GET /audit/denied
   Отказы доступа. Admin / compliance_officer.
   Query: ?from=&userId=&limit= */
router.get("/denied", auditController.getDeniedAttempts);

export default router;
