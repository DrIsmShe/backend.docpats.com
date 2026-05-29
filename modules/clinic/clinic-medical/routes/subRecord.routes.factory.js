// modules/clinic/clinic-medical/routes/subRecord.routes.factory.js
//
// Routes factory for clinic-medical sub-records.
// Sprint 2 Phase 2C.
//
// Builds an Express router with the standard 5 endpoints for a sub-record,
// wired with the full middleware chain (audit → RBAC → resolve → consent).
//
// All five sub-models call this factory with their own:
//   - controller (from buildSubRecordController)
//   - resourceType + actions (audit + RBAC)
//   - scope (consent)
//
// Final URLs (when mounted at /medical):
//   POST   /medical/patients/:patientId/<resource>
//   GET    /medical/patients/:patientId/<resource>
//   GET    /medical/<resource>/:recordId
//   PATCH  /medical/<resource>/:recordId
//   DELETE /medical/<resource>/:recordId
//
// NOTE: sub-records don't have a resolveEncounter-style middleware for the
// single-record routes (get/update/delete). The service loads + access-checks
// the record itself (decideRecordAccess inside subRecordBase). So consent
// middleware is NOT chained on single-record routes — the service is the
// gatekeeper. For LIST we still resolve the patient + can rely on service
// filtering. This keeps the chain simpler than encounter (which needed
// resolveEncounter because controllers operated on req.medicalRecord).

import express from "express";
import auditMiddleware from "../../../audit/middleware/auditMiddleware.js";
import { checkClinicMedicalAccess } from "../middleware/checkClinicMedicalAccess.middleware.js";
import { resolveClinicPatient } from "../middleware/resolveClinicPatient.middleware.js";

/**
 * @param {object} cfg
 * @param {string} cfg.resourcePath   — URL segment, e.g. "allergies"
 * @param {string} cfg.resourceType   — audit resourceType, e.g. "clinic-medical-allergy"
 * @param {object} cfg.actions        — { create, read, list, update, delete } RBAC/audit action strings
 * @param {object} cfg.controller     — built controller { create, get, list, update, remove }
 * @returns {express.Router}
 */
export function buildSubRecordRouter(cfg) {
  const { resourcePath, resourceType, actions, controller } = cfg;

  if (!resourcePath || !resourceType || !actions || !controller) {
    throw new Error(
      "buildSubRecordRouter requires resourcePath, resourceType, actions, controller",
    );
  }

  const router = express.Router();

  // ─── CREATE: POST /patients/:patientId/<resource> ───────────────
  router.post(
    `/patients/:patientId/${resourcePath}`,
    auditMiddleware({
      resourceType,
      action: actions.create,
      resourceIdFrom: () => null,
      resourceOwnerIdFrom: (req) => req.clinicPatient?.linkedUserId || null,
      metaFrom: (req) => ({
        patientId: req.params?.patientId,
        sharedWithCount: Array.isArray(req.body?.sharedWith)
          ? req.body.sharedWith.length
          : 0,
      }),
    }),
    checkClinicMedicalAccess({ action: actions.create }),
    resolveClinicPatient,
    controller.create,
  );

  // ─── LIST: GET /patients/:patientId/<resource> ──────────────────
  router.get(
    `/patients/:patientId/${resourcePath}`,
    auditMiddleware({
      resourceType,
      action: actions.list,
      resourceIdFrom: () => null,
      resourceOwnerIdFrom: (req) => req.clinicPatient?.linkedUserId || null,
      metaFrom: (req) => ({
        patientId: req.params?.patientId,
        limit: Number(req.query?.limit) || 100,
      }),
    }),
    checkClinicMedicalAccess({ action: actions.list }),
    resolveClinicPatient,
    controller.list,
  );

  // ─── GET single: GET /<resource>/:recordId ──────────────────────
  // Access decided inside service (ownership / sharedWith / consent).
  router.get(
    `/${resourcePath}/:recordId`,
    auditMiddleware({
      resourceType,
      action: actions.read,
      resourceIdFrom: "params.recordId",
    }),
    checkClinicMedicalAccess({ action: actions.read }),
    controller.get,
  );

  // ─── UPDATE: PATCH /<resource>/:recordId ────────────────────────
  router.patch(
    `/${resourcePath}/:recordId`,
    auditMiddleware({
      resourceType,
      action: actions.update,
      resourceIdFrom: "params.recordId",
      metaFrom: (req) => ({
        changedFields: Object.keys(req.body || {}),
      }),
    }),
    checkClinicMedicalAccess({ action: actions.update }),
    controller.update,
  );

  // ─── DELETE: DELETE /<resource>/:recordId ───────────────────────
  router.delete(
    `/${resourcePath}/:recordId`,
    auditMiddleware({
      resourceType,
      action: actions.delete,
      resourceIdFrom: "params.recordId",
    }),
    checkClinicMedicalAccess({ action: actions.delete }),
    controller.remove,
  );

  return router;
}

export default buildSubRecordRouter;
