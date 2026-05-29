// modules/clinic/clinic-medical/routes/medicalHistory.routes.js
//
// REST endpoints for clinic-medical encounters (UMR).
// Sprint 2 Phase 2B.
//
// Mount path (from parent clinic router): /api/v1/clinic/medical/*
// Final URLs:
//   POST   /api/v1/clinic/medical/patients/:patientId/encounters
//   GET    /api/v1/clinic/medical/patients/:patientId/encounters
//   GET    /api/v1/clinic/medical/encounters/:encounterId
//   PATCH  /api/v1/clinic/medical/encounters/:encounterId
//   PATCH  /api/v1/clinic/medical/encounters/:encounterId/sign
//   PATCH  /api/v1/clinic/medical/encounters/:encounterId/amend
//   DELETE /api/v1/clinic/medical/encounters/:encounterId
//
// ─────────────────────────────────────────────────────────────────────────────
//  MIDDLEWARE CHAIN ORDER
// ─────────────────────────────────────────────────────────────────────────────
//
//   1. tenantMiddleware     — sets req.tenantContext
//                              (mounted at parent /clinic level, NOT here)
//   2. auditMiddleware      — schedules audit log write on res.finish
//   3. checkClinicMedicalAccess — RBAC fine-grained role × action check
//   4. resolveClinicPatient / resolveEncounter — load entity
//   5. checkConsent          — ownership / sharedWith / consent
//   6. controller
//
// Note: tenantMiddleware is assumed to be already mounted by the
// parent clinic router (see modules/clinic/index.js). If you mount
// these routes elsewhere, add tenantMiddleware({ required: true })
// at the top.

import express from "express";
import auditMiddleware from "../../../audit/middleware/auditMiddleware.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import { checkClinicMedicalAccess } from "../middleware/checkClinicMedicalAccess.middleware.js";
import { resolveClinicPatient } from "../middleware/resolveClinicPatient.middleware.js";
import { resolveEncounter } from "../middleware/resolveEncounter.middleware.js";
import { checkConsent } from "../middleware/checkConsent.middleware.js";
import * as ctrl from "../controllers/medicalHistory.controller.js";

const router = express.Router();

// ─── POST /patients/:patientId/encounters ─────────────────────────────
// Create new encounter. No checkConsent on create — clinic creating
// the record IS the owner. Patient-level access is checked by
// resolveClinicPatient (tenantScoped plugin filters by clinicId).
router.post(
  "/patients/:patientId/encounters",
  auditMiddleware({
    resourceType: "clinic-medical-encounter",
    action: ACTIONS.ENCOUNTER.CREATE,
    resourceIdFrom: (req) => null, // ID not known until service.create
    resourceOwnerIdFrom: (req) => req.clinicPatient?.linkedUserId || null,
    metaFrom: (req) => ({
      patientId: req.params?.patientId,
      status: req.body?.status || "signed",
      hasMainDiagnosis: Boolean(req.body?.mainDiagnosis),
      sharedWithCount: Array.isArray(req.body?.sharedWith)
        ? req.body.sharedWith.length
        : 0,
    }),
  }),
  checkClinicMedicalAccess({ action: ACTIONS.ENCOUNTER.CREATE }),
  resolveClinicPatient,
  ctrl.createEncounter,
);

// ─── GET /patients/:patientId/encounters ──────────────────────────────
// List encounters for a patient. Access chain: own clinic +
// sharedWith + global consent.
router.get(
  "/patients/:patientId/encounters",
  auditMiddleware({
    resourceType: "clinic-medical-encounter",
    action: ACTIONS.ENCOUNTER.LIST,
    resourceIdFrom: (req) => null,
    resourceOwnerIdFrom: (req) => req.clinicPatient?.linkedUserId || null,
    metaFrom: (req) => ({
      patientId: req.params?.patientId,
      hasStatusFilter: Boolean(req.query?.status),
      limit: Number(req.query?.limit) || 50,
    }),
  }),
  checkClinicMedicalAccess({ action: ACTIONS.ENCOUNTER.LIST }),
  resolveClinicPatient,
  checkConsent({ scope: "encounters", patientLevel: true }),
  ctrl.listEncounters,
);

// ─── GET /encounters/:encounterId ─────────────────────────────────────
// Read single encounter.
router.get(
  "/encounters/:encounterId",
  auditMiddleware({
    resourceType: "clinic-medical-encounter",
    action: ACTIONS.ENCOUNTER.READ,
    resourceIdFrom: "params.encounterId",
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
  checkClinicMedicalAccess({ action: ACTIONS.ENCOUNTER.READ }),
  resolveEncounter,
  checkConsent({ scope: "encounters" }),
  ctrl.getEncounter,
);

// ─── PATCH /encounters/:encounterId ───────────────────────────────────
// Update DRAFT only (service-enforced). Signed/amended go through
// dedicated endpoints.
router.patch(
  "/encounters/:encounterId",
  auditMiddleware({
    resourceType: "clinic-medical-encounter",
    action: ACTIONS.ENCOUNTER.UPDATE,
    resourceIdFrom: "params.encounterId",
    metaFrom: (req) => ({
      changedFields: Object.keys(req.body || {}),
      preStatus: req.medicalRecord?.status || null,
    }),
  }),
  checkClinicMedicalAccess({ action: ACTIONS.ENCOUNTER.UPDATE }),
  resolveEncounter,
  checkConsent({ scope: "encounters" }),
  ctrl.updateEncounter,
);

// ─── PATCH /encounters/:encounterId/sign ──────────────────────────────
// draft → signed transition. Doctor finalizes the record.
router.patch(
  "/encounters/:encounterId/sign",
  auditMiddleware({
    resourceType: "clinic-medical-encounter",
    action: ACTIONS.ENCOUNTER.SIGN,
    resourceIdFrom: "params.encounterId",
    metaFrom: (req) => ({
      preStatus: req.medicalRecord?.status || null,
      diagnosisSetAtSign: Boolean(req.body?.mainDiagnosis),
    }),
  }),
  checkClinicMedicalAccess({ action: ACTIONS.ENCOUNTER.SIGN }),
  resolveEncounter,
  checkConsent({ scope: "encounters" }),
  ctrl.signEncounter,
);

// ─── PATCH /encounters/:encounterId/amend ─────────────────────────────
// signed/amended → amended (correction with explicit reason).
router.patch(
  "/encounters/:encounterId/amend",
  auditMiddleware({
    resourceType: "clinic-medical-encounter",
    action: ACTIONS.ENCOUNTER.AMEND,
    resourceIdFrom: "params.encounterId",
    metaFrom: (req) => ({
      preStatus: req.medicalRecord?.status || null,
      hasReason: Boolean(req.body?.reason),
      changedFields: Object.keys(req.body || {}).filter((k) => k !== "reason"),
    }),
  }),
  checkClinicMedicalAccess({ action: ACTIONS.ENCOUNTER.AMEND }),
  resolveEncounter,
  checkConsent({ scope: "encounters" }),
  ctrl.amendEncounter,
);

// ─── DELETE /encounters/:encounterId ──────────────────────────────────
// HARD delete. Only owner role per RBAC + ROLE_PERMISSIONS.
// Audit log preserves the action; the record itself is gone.
router.delete(
  "/encounters/:encounterId",
  auditMiddleware({
    resourceType: "clinic-medical-encounter",
    action: ACTIONS.ENCOUNTER.DELETE,
    resourceIdFrom: "params.encounterId",
    metaFrom: (req) => ({
      preStatus: req.medicalRecord?.status || null,
      patientRef: req.medicalRecord?.patientRef
        ? String(req.medicalRecord.patientRef)
        : null,
    }),
  }),
  checkClinicMedicalAccess({ action: ACTIONS.ENCOUNTER.DELETE }),
  resolveEncounter,
  checkConsent({ scope: "encounters" }),
  ctrl.deleteEncounter,
);

export default router;
