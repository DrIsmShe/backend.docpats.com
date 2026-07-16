// server/modules/clinic/clinic-telemed/routes/telemed.routes.js
//
// Routes for TelemedSession. Mounted in clinic/index.js via
// `router.use("/", clinicTelemedRouter)`, so the full /telemed prefix lives here.
//
// RBAC: телемед касается лечения пациента — доступ по матрице прав (ресурс
// "telemed"). Раньше проверки не было вообще: любой сотрудник любой роли
// (в т.ч. marketer без доступа к пациентам) мог создавать/отменять сессии.
// AUDIT: сессия содержит клинические заметки (PHI) → доступ логируется в
// hipaa_audit_logs (§164.312(b)). Раньше аудита не было.

import express from "express";
import * as ctrl from "../controllers/telemed.controller.js";
import { issueTelemedVideoTokenController } from "../controllers/telemedVideo.controller.js";
import { requireClinicPerm } from "../../../../common/middlewares/requireClinicPerm.js";
import { auditMiddleware } from "../../../audit/index.js";

const router = express.Router();

router.get(
  "/telemed",
  requireClinicPerm("telemed", "read"),
  ctrl.listSessionsController,
);
router.post(
  "/telemed",
  requireClinicPerm("telemed", "write"),
  auditMiddleware({
    resourceType: "telemed-session",
    action: "create",
    resourceIdFrom: "body.patientId",
  }),
  ctrl.createSessionController,
);

// Video room token (specific segment — declared before the bare /:id routes)
router.post(
  "/telemed/:id/video-token",
  requireClinicPerm("telemed", "read"),
  issueTelemedVideoTokenController,
);

router.get(
  "/telemed/:id",
  requireClinicPerm("telemed", "read"),
  auditMiddleware({
    resourceType: "telemed-session",
    action: "read",
    resourceIdFrom: "params.id",
  }),
  ctrl.getSessionController,
);
router.patch(
  "/telemed/:id",
  requireClinicPerm("telemed", "write"),
  auditMiddleware({
    resourceType: "telemed-session",
    action: "update",
    resourceIdFrom: "params.id",
  }),
  ctrl.updateSessionController,
);
router.delete(
  "/telemed/:id",
  requireClinicPerm("telemed", "write"),
  auditMiddleware({
    resourceType: "telemed-session",
    action: "delete",
    resourceIdFrom: "params.id",
  }),
  ctrl.cancelSessionController,
);

export default router;
