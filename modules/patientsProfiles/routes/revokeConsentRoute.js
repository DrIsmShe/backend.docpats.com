// server/modules/patientsProfiles/routes/revokeConsentRoute.js
//
// DELETE /patient-profile/revoke-consent/:id
// Body: { reason?: string }
// Sprint 3.1 (PatientConsent UI MVP).

import express from "express";
import { revokeConsent } from "../controllers/patientConsent.controller.js";

const router = express.Router();

router.delete("/:id", revokeConsent);

export default router;
