// modules/clinic/clinic-medical/routes/imaging.routes.js
//
// Imaging study routes for clinic-medical. Sprint 2 Phase 2C.2.
//
// ─────────────────────────────────────────────────────────────────────────────
//  ⚠️ ASYNC LOCAL STORAGE + MULTER WORKAROUND
// ─────────────────────────────────────────────────────────────────────────────
//
// Multer uses Node streams to parse multipart/form-data. Streams break the
// AsyncLocalStorage context chain — so by the time the controller runs after
// upload.array() + processFiles, getCurrentClinicId() returns undefined and
// the service rightfully refuses with "No active clinic context".
//
// Encounter create (pure JSON body) works because express.json() doesn't use
// streams the same way and preserves the ALS context.
//
// Fix: re-establish the tenant context AFTER the multer chain, using the
// snapshot stashed on req.tenantContext by tenantMiddleware upstream. Wrap
// the controller call in runWithTenantContext so the service sees the right
// clinicId / userId / role.
//
// This is a known Node.js limitation; same pattern would be needed for any
// future multipart endpoint in clinic-medical.

import express from "express";
import auditMiddleware from "../../../audit/middleware/auditMiddleware.js";
import { runWithTenantContext } from "../../../../common/context/tenantContext.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import { checkClinicMedicalAccess } from "../middleware/checkClinicMedicalAccess.middleware.js";
import { resolveClinicPatient } from "../middleware/resolveClinicPatient.middleware.js";
import {
  upload,
  processFiles,
} from "../../../../common/middlewares/uploadMiddleware.js";
import * as ctrl from "../controllers/imaging.controller.js";

const router = express.Router();

/**
 * Re-bind the AsyncLocalStorage tenant context that gets lost in multer's
 * stream pipeline. Place AFTER upload + processFiles, BEFORE the controller.
 */
function rebindTenantContext(req, res, next) {
  const ctx = req.tenantContext;
  if (!ctx) {
    // Should not happen if tenantMiddleware ran upstream, but guard anyway.
    return next();
  }
  runWithTenantContext(ctx, () => next());
}

// ─── CREATE (multipart with files) ────────────────────────────────────
// No auditMiddleware here — see encoder create / Phase 2B pattern.
// Controller records the audit manually after service.create with the
// freshly minted resourceId.
router.post(
  "/patients/:patientId/imaging",
  checkClinicMedicalAccess({ action: ACTIONS.IMAGING.CREATE }),
  resolveClinicPatient,
  upload.array("images", 20),
  processFiles,
  rebindTenantContext, // ← restore ALS context after multer streams
  ctrl.createImaging,
);

// ─── LIST ──────────────────────────────────────────────────────────────
router.get(
  "/patients/:patientId/imaging",
  auditMiddleware({
    resourceType: "clinic-medical-imaging-study",
    action: ACTIONS.IMAGING.LIST,
    resourceIdFrom: () => null,
    resourceOwnerIdFrom: (req) => req.clinicPatient?.linkedUserId || null,
    metaFrom: (req) => ({
      patientId: req.params?.patientId,
      studyTypeFilter: req.query?.studyType || null,
    }),
  }),
  checkClinicMedicalAccess({ action: ACTIONS.IMAGING.LIST }),
  resolveClinicPatient,
  ctrl.listImaging,
);

// ─── GET single ──────────────────────────────────────────────────────
router.get(
  "/imaging/:recordId",
  auditMiddleware({
    resourceType: "clinic-medical-imaging-study",
    action: ACTIONS.IMAGING.READ,
    resourceIdFrom: "params.recordId",
  }),
  checkClinicMedicalAccess({ action: ACTIONS.IMAGING.READ }),
  ctrl.getImaging,
);

// ─── UPDATE ──────────────────────────────────────────────────────────
router.patch(
  "/imaging/:recordId",
  auditMiddleware({
    resourceType: "clinic-medical-imaging-study",
    action: ACTIONS.IMAGING.UPDATE,
    resourceIdFrom: "params.recordId",
    metaFrom: (req) => ({
      changedFields: Object.keys(req.body || {}),
    }),
  }),
  checkClinicMedicalAccess({ action: ACTIONS.IMAGING.UPDATE }),
  ctrl.updateImaging,
);

// ─── DELETE ──────────────────────────────────────────────────────────
router.delete(
  "/imaging/:recordId",
  auditMiddleware({
    resourceType: "clinic-medical-imaging-study",
    action: ACTIONS.IMAGING.DELETE,
    resourceIdFrom: "params.recordId",
  }),
  checkClinicMedicalAccess({ action: ACTIONS.IMAGING.DELETE }),
  ctrl.deleteImaging,
);

export default router;
