// server/modules/clinic/clinic-consilium/routes/consilium.routes.js
//
// Routes for Consilium + messages. Mounted in clinic/index.js via
// `router.use("/", clinicConsiliumRouter)`, so the full /consilia prefix lives
// here. Message routes carry an extra /messages segment so they never collide
// with /consilia/:id.
//
// RBAC: консилиум — обсуждение случая пациента, доступ по матрице (ресурс
// "consilium"). Раньше проверки не было: любой сотрудник любой роли мог
// создавать/архивировать консилиумы и читать переписку.
// AUDIT: сообщения консилиума содержат PHI → доступ логируется (§164.312(b)).

import express from "express";
import * as ctrl from "../controllers/consilium.controller.js";
import { issueConsiliumVideoTokenController } from "../controllers/consiliumVideo.controller.js";
import { requireClinicPerm } from "../../../../common/middlewares/requireClinicPerm.js";
import { auditMiddleware } from "../../../audit/index.js";

const router = express.Router();

// Collection
router.get(
  "/consilia",
  requireClinicPerm("consilium", "read"),
  ctrl.listConsiliaController,
);
router.post(
  "/consilia",
  requireClinicPerm("consilium", "write"),
  auditMiddleware({
    resourceType: "consilium",
    action: "create",
    resourceIdFrom: "body.patientId",
  }),
  ctrl.createConsiliumController,
);

// Messages (more specific — declared before the bare /:id routes)
router.get(
  "/consilia/:id/messages",
  requireClinicPerm("consilium", "read"),
  auditMiddleware({
    resourceType: "consilium-message",
    action: "list",
    resourceIdFrom: "params.id",
  }),
  ctrl.listMessagesController,
);
router.post(
  "/consilia/:id/messages",
  requireClinicPerm("consilium", "write"),
  auditMiddleware({
    resourceType: "consilium-message",
    action: "create",
    resourceIdFrom: "params.id",
  }),
  ctrl.createMessageController,
);

// Video room token (specific segment — declared before the bare /:id routes)
router.post(
  "/consilia/:id/video-token",
  requireClinicPerm("consilium", "read"),
  issueConsiliumVideoTokenController,
);

// Single consilium
router.get(
  "/consilia/:id",
  requireClinicPerm("consilium", "read"),
  auditMiddleware({
    resourceType: "consilium",
    action: "read",
    resourceIdFrom: "params.id",
  }),
  ctrl.getConsiliumController,
);
router.patch(
  "/consilia/:id",
  requireClinicPerm("consilium", "write"),
  auditMiddleware({
    resourceType: "consilium",
    action: "update",
    resourceIdFrom: "params.id",
  }),
  ctrl.updateConsiliumController,
);
router.delete(
  "/consilia/:id",
  requireClinicPerm("consilium", "write"),
  auditMiddleware({
    resourceType: "consilium",
    action: "delete",
    resourceIdFrom: "params.id",
  }),
  ctrl.archiveConsiliumController,
);

export default router;
