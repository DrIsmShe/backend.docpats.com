// server/modules/patientsProfiles/routes/updateConsentScopesRoute.js
//
// PATCH /patient-profile/update-consent-scopes/:id
// Body: { scopes: {encounters?, allergies?, ...} }
// Sprint 3.1 (PatientConsent UI MVP).

import express from "express";
import { updateConsentScopes } from "../controllers/patientConsent.controller.js";

const router = express.Router();

router.patch("/:id", updateConsentScopes);

export default router;
