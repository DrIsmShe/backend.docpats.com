// modules/clinic/clinic-medical/routes/prescription.routes.js
//
// REST endpoints for clinic-medical prescriptions. Stage 2 #4.
//
// Mount path (from parent clinic router): /api/v1/clinic/medical/*
// Final URLs:
//   POST   /api/v1/clinic/medical/patients/:patientId/prescriptions
//   GET    /api/v1/clinic/medical/patients/:patientId/prescriptions
//   GET    /api/v1/clinic/medical/prescriptions/:id
//   PATCH  /api/v1/clinic/medical/prescriptions/:id/cancel
//   PATCH  /api/v1/clinic/medical/prescriptions/:id/complete
//   GET    /api/v1/clinic/medical/prescriptions/:id/pdf
//   DELETE /api/v1/clinic/medical/prescriptions/:id
//
// ─────────────────────────────────────────────────────────────────────────────
//  MIDDLEWARE CHAIN ORDER (identical to medicalHistory.routes.js)
// ─────────────────────────────────────────────────────────────────────────────
//
//   1. tenantMiddleware     — sets req.tenantContext
//                              (mounted at parent /clinic level, NOT here)
//   2. auditMiddleware      — schedules audit log write on res.finish
//   3. checkClinicMedicalAccess — RBAC fine-grained role × action check
//   4. resolveClinicPatient / resolvePrescription — load entity
//   5. checkConsent          — ownership / sharedWith / consent
//   6. controller
//
// Scope is always "encounters" — prescriptions ride on that consent scope
// (no separate prescription scope, per Sprint 3 architecture).
//
// Route ordering: specific "/prescriptions/:id/..." subpaths are declared
// before the bare "/prescriptions/:id" to avoid shadowing.

import express from "express";
import auditMiddleware from "../../../audit/middleware/auditMiddleware.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import { checkClinicMedicalAccess } from "../middleware/checkClinicMedicalAccess.middleware.js";
import { resolveClinicPatient } from "../middleware/resolveClinicPatient.middleware.js";
import { resolvePrescription } from "../middleware/resolvePrescription.middleware.js";
import { checkConsent } from "../middleware/checkConsent.middleware.js";
import * as ctrl from "../controllers/prescription.controller.js";

const router = express.Router();

const RX = ACTIONS.PRESCRIPTION;

// ─── POST /patients/:patientId/prescriptions ──────────────────────────
// Create (issue) a prescription. No checkConsent on create — clinic
// creating the record IS the owner.
//
// NOTE: NO auditMiddleware here. resourceId only exists after the service
// creates the document, so the controller calls recordActionAsync directly
// (success + failure paths). Same pattern as imaging.controller.js.
router.post(
  "/patients/:patientId/prescriptions",
  checkClinicMedicalAccess({ action: RX.CREATE }),
  resolveClinicPatient,
  ctrl.createPrescriptionController,
);

// ─── GET /patients/:patientId/prescriptions ───────────────────────────
// List prescriptions for a patient. Access chain: own clinic +
// sharedWith + global consent.
router.get(
  "/patients/:patientId/prescriptions",
  auditMiddleware({
    resourceType: "clinic-medical-prescription",
    action: RX.LIST,
    resourceIdFrom: (req) => null,
    resourceOwnerIdFrom: (req) => req.clinicPatient?.linkedUserId || null,
    metaFrom: (req) => ({
      patientId: req.params?.patientId,
      hasStatusFilter: Boolean(req.query?.status),
      limit: Number(req.query?.limit) || 50,
    }),
  }),
  checkClinicMedicalAccess({ action: RX.LIST }),
  resolveClinicPatient,
  checkConsent({ scope: "encounters", patientLevel: true }),
  ctrl.listPrescriptionsController,
);

// ─── PATCH /prescriptions/:id/cancel ──────────────────────────────────
router.patch(
  "/prescriptions/:id/cancel",
  auditMiddleware({
    resourceType: "clinic-medical-prescription",
    action: RX.CANCEL,
    resourceIdFrom: "params.id",
    metaFrom: (req) => ({
      preStatus: req.medicalRecord?.status || null,
      hasReason: Boolean(req.body?.reason),
    }),
  }),
  checkClinicMedicalAccess({ action: RX.CANCEL }),
  resolvePrescription,
  checkConsent({ scope: "encounters" }),
  ctrl.cancelPrescriptionController,
);

// ─── PATCH /prescriptions/:id/complete ────────────────────────────────
router.patch(
  "/prescriptions/:id/complete",
  auditMiddleware({
    resourceType: "clinic-medical-prescription",
    action: RX.COMPLETE,
    resourceIdFrom: "params.id",
    metaFrom: (req) => ({
      preStatus: req.medicalRecord?.status || null,
    }),
  }),
  checkClinicMedicalAccess({ action: RX.COMPLETE }),
  resolvePrescription,
  checkConsent({ scope: "encounters" }),
  ctrl.completePrescriptionController,
);

// ─── GET /prescriptions/:id/pdf ───────────────────────────────────────
// Specific subpath BEFORE bare /:id read.
router.get(
  "/prescriptions/:id/pdf",
  auditMiddleware({
    resourceType: "clinic-medical-prescription",
    action: RX.EXPORT,
    resourceIdFrom: "params.id",
    resourceOwnerIdFrom: (req) =>
      req.medicalRecord?.patientRef
        ? String(req.medicalRecord.patientRef)
        : null,
    metaFrom: (req) => ({
      lang: req.query?.lang || null,
    }),
  }),
  checkClinicMedicalAccess({ action: RX.EXPORT }),
  resolvePrescription,
  checkConsent({ scope: "encounters" }),
  ctrl.prescriptionPdfController,
);

// ─── DELETE /prescriptions/:id (owner only via RBAC) ──────────────────
router.delete(
  "/prescriptions/:id",
  auditMiddleware({
    resourceType: "clinic-medical-prescription",
    action: RX.DELETE,
    resourceIdFrom: "params.id",
    metaFrom: (req) => ({
      preStatus: req.medicalRecord?.status || null,
      patientRef: req.medicalRecord?.patientRef
        ? String(req.medicalRecord.patientRef)
        : null,
    }),
  }),
  checkClinicMedicalAccess({ action: RX.DELETE }),
  resolvePrescription,
  checkConsent({ scope: "encounters" }),
  ctrl.deletePrescriptionController,
);

// ─── GET /prescriptions/:id (bare read — register LAST) ───────────────
router.get(
  "/prescriptions/:id",
  auditMiddleware({
    resourceType: "clinic-medical-prescription",
    action: RX.READ,
    resourceIdFrom: "params.id",
    resourceOwnerIdFrom: (req) =>
      req.medicalRecord?.patientRef
        ? String(req.medicalRecord.patientRef)
        : null,
    metaFrom: (req) => ({
      status: req.medicalRecord?.status || null,
      isCrossClinic: Boolean(req.consentDecision?.isCrossClinic),
      decisionReason: req.consentDecision?.reason || null,
    }),
  }),
  checkClinicMedicalAccess({ action: RX.READ }),
  resolvePrescription,
  checkConsent({ scope: "encounters" }),
  ctrl.getPrescriptionController,
);

export default router;
