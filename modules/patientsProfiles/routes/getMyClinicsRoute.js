// server/modules/patientsProfiles/routes/getMyClinicsRoute.js
//
// GET /patient-profile/my-clinics
// Sprint 3.1 (PatientConsent UI MVP).

import express from "express";
import { getMyClinics } from "../controllers/patientConsent.controller.js";

const router = express.Router();

router.get("/", getMyClinics);

export default router;
