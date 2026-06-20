// modules/clinic/clinic-medical/routes/labResult.routes.js
//
// REST endpoints for clinic-medical lab results (Stage 2 — A, Variant X).
// Mount path (from parent clinic router): /api/v1/clinic/medical/*
//
// Final URLs:
//   POST   /clinic/medical/patients/:patientId/lab-results        (multipart, optional file)
//   GET    /clinic/medical/patients/:patientId/lab-results
//   GET    /clinic/medical/patients/:patientId/lab-results/trend
//   GET    /clinic/medical/lab-results/:id
//   PATCH  /clinic/medical/lab-results/:id/status
//   POST   /clinic/medical/lab-results/:id/comments
//   GET    /clinic/medical/lab-results/:id/pdf
//   DELETE /clinic/medical/lab-results/:id
//
// Middleware chain identical to prescription.routes + imaging multipart rebind.
// Scope "encounters" — labs ride on the encounters consent scope.

import express from "express";
import auditMiddleware from "../../../audit/middleware/auditMiddleware.js";
import { runWithTenantContext } from "../../../../common/context/tenantContext.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import { checkClinicMedicalAccess } from "../middleware/checkClinicMedicalAccess.middleware.js";
import { resolveClinicPatient } from "../middleware/resolveClinicPatient.middleware.js";
import { resolveLabResult } from "../middleware/resolveLabResult.middleware.js";
import { checkConsent } from "../middleware/checkConsent.middleware.js";
import {
  upload,
  processFiles,
} from "../../../../common/middlewares/uploadMiddleware.js";
import * as ctrl from "../controllers/labResult.controller.js";

const router = express.Router();
const LR = ACTIONS.LAB_RESULT;

// Re-bind ALS tenant context lost in multer streams (imaging pattern).
function rebindTenantContext(req, res, next) {
  const ctx = req.tenantContext;
  if (!ctx) return next();
  runWithTenantContext(ctx, () => next());
}

// ─── CREATE (multipart, optional single original file) ────────────────
// No auditMiddleware — controller records manually after create.
router.post(
  "/patients/:patientId/lab-results",
  checkClinicMedicalAccess({ action: LR.CREATE }),
  resolveClinicPatient,
  upload.array("file", 1), // processFiles reads req.files (not req.file)
  processFiles,
  rebindTenantContext,
  ctrl.createLabResultController,
);

// ─── LIST ──────────────────────────────────────────────────────────────
router.get(
  "/patients/:patientId/lab-results",
  auditMiddleware({
    resourceType: "clinic-medical-lab-result",
    action: LR.LIST,
    resourceIdFrom: () => null,
    resourceOwnerIdFrom: (req) => req.clinicPatient?.linkedUserId || null,
    metaFrom: (req) => ({
      patientId: req.params?.patientId,
      panelTypeFilter: req.query?.panelType || null,
    }),
  }),
  checkClinicMedicalAccess({ action: LR.LIST }),
  resolveClinicPatient,
  checkConsent({ scope: "encounters", patientLevel: true }),
  ctrl.listLabResultsController,
);

// ─── TREND (динамика показателя) ──────────────────────────────────────
router.get(
  "/patients/:patientId/lab-results/trend",
  auditMiddleware({
    resourceType: "clinic-medical-lab-result",
    action: LR.LIST,
    resourceIdFrom: () => null,
    resourceOwnerIdFrom: (req) => req.clinicPatient?.linkedUserId || null,
    metaFrom: (req) => ({
      patientId: req.params?.patientId,
      param: req.query?.name || req.query?.loincCode || null,
    }),
  }),
  checkClinicMedicalAccess({ action: LR.LIST }),
  resolveClinicPatient,
  checkConsent({ scope: "encounters", patientLevel: true }),
  ctrl.labTrendController,
);

// ─── PATCH /lab-results/:id/status (FSM) ──────────────────────────────
router.patch(
  "/lab-results/:id/status",
  auditMiddleware({
    resourceType: "clinic-medical-lab-result",
    action: LR.UPDATE,
    resourceIdFrom: "params.id",
    metaFrom: (req) => ({
      preStatus: req.medicalRecord?.status || null,
      newStatus: req.body?.status || null,
    }),
  }),
  checkClinicMedicalAccess({ action: LR.UPDATE }),
  resolveLabResult,
  checkConsent({ scope: "encounters" }),
  ctrl.updateLabStatusController,
);

// ─── POST /lab-results/:id/comments ───────────────────────────────────
router.post(
  "/lab-results/:id/comments",
  auditMiddleware({
    resourceType: "clinic-medical-lab-result",
    action: LR.UPDATE,
    resourceIdFrom: "params.id",
  }),
  checkClinicMedicalAccess({ action: LR.UPDATE }),
  resolveLabResult,
  checkConsent({ scope: "encounters" }),
  ctrl.addLabCommentController,
);

// ─── GET /lab-results/:id/pdf (specific subpath BEFORE bare :id) ──────
router.get(
  "/lab-results/:id/pdf",
  auditMiddleware({
    resourceType: "clinic-medical-lab-result",
    action: LR.EXPORT,
    resourceIdFrom: "params.id",
    resourceOwnerIdFrom: (req) =>
      req.medicalRecord?.patientRef
        ? String(req.medicalRecord.patientRef)
        : null,
    metaFrom: (req) => ({ lang: req.query?.lang || null }),
  }),
  checkClinicMedicalAccess({ action: LR.EXPORT }),
  resolveLabResult,
  checkConsent({ scope: "encounters" }),
  ctrl.labResultPdfController,
);

// ─── DELETE /lab-results/:id (owner only via RBAC) ────────────────────
router.delete(
  "/lab-results/:id",
  auditMiddleware({
    resourceType: "clinic-medical-lab-result",
    action: LR.DELETE,
    resourceIdFrom: "params.id",
    metaFrom: (req) => ({
      preStatus: req.medicalRecord?.status || null,
      patientRef: req.medicalRecord?.patientRef
        ? String(req.medicalRecord.patientRef)
        : null,
    }),
  }),
  checkClinicMedicalAccess({ action: LR.DELETE }),
  resolveLabResult,
  checkConsent({ scope: "encounters" }),
  ctrl.deleteLabResultController,
);

// ─── GET /lab-results/:id (bare read — register LAST) ─────────────────
router.get(
  "/lab-results/:id",
  auditMiddleware({
    resourceType: "clinic-medical-lab-result",
    action: LR.READ,
    resourceIdFrom: "params.id",
    resourceOwnerIdFrom: (req) =>
      req.medicalRecord?.patientRef
        ? String(req.medicalRecord.patientRef)
        : null,
    metaFrom: (req) => ({
      status: req.medicalRecord?.status || null,
      isCrossClinic: Boolean(req.consentDecision?.isCrossClinic),
    }),
  }),
  checkClinicMedicalAccess({ action: LR.READ }),
  resolveLabResult,
  checkConsent({ scope: "encounters" }),
  ctrl.getLabResultController,
);

export default router;
