// server/modules/clinic/clinic-patients/routes/consent.routes.js
//
// Routes for CLINIC-SIDE management of GRANTED consents (PatientConsent).
// Sprint 3 closure (Pull Consent, part B).
//
// Mount path (from parent clinic router): /api/v1/clinic/*
// Final URLs:
//   GET    /api/v1/clinic/patients/:cardId/consents
//   DELETE /api/v1/clinic/consents/:id
//
// tenantMiddleware and session are applied at parent router level —
// we don't repeat them here. Mirrors consentRequest.routes.js pattern.
//
// AUDIT:
//   • GET (list)  → middleware (resourceId not required for collection reads)
//   • DELETE      → middleware (resourceId from params.id). NOTE: consent.service
//                   ALSO writes patient.consent.revoke inside revokeConsent.
//                   Middleware logs the HTTP action; service logs the domain
//                   event. Both is fine (different action names).

import express from "express";
import * as ctrl from "../controllers/consent.clinic.controller.js";
import auditMiddleware from "../../../audit/middleware/auditMiddleware.js";
import { requireClinicPerm } from "../../../../common/middlewares/requireClinicPerm.js";

const router = express.Router();

// ─── GET /clinic/patients/:cardId/consents ────────────────────────────
router.get(
  "/patients/:cardId/consents",
  requireClinicPerm("patient", "read"),
  auditMiddleware({
    resourceType: "patient-consent",
    action: "patient.consent.list",
    metaFrom: (req) => ({
      cardId: req.params?.cardId || null,
    }),
  }),
  ctrl.listConsentsForPatient,
);

// ─── DELETE /clinic/consents/:id ──────────────────────────────────────
// Clinic revokes a consent it holds for the patient.
router.delete(
  "/consents/:id",
  requireClinicPerm("patient", "write"),
  auditMiddleware({
    resourceType: "patient-consent",
    action: "patient.consent.revoke_by_clinic",
    resourceIdFrom: "params.id",
  }),
  ctrl.revokeClinicConsent,
);

export default router;
