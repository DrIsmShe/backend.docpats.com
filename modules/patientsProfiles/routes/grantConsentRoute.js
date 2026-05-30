// server/modules/patientsProfiles/routes/grantConsentRoute.js
//
// POST /patient-profile/grant-consent
// Body: { cardId, scopes: {encounters, allergies, ...} }
// Sprint 3.1 (PatientConsent UI MVP).

import express from "express";
import { grantConsent } from "../controllers/patientConsent.controller.js";

const router = express.Router();

router.post("/", grantConsent);

export default router;
