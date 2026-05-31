// server/modules/patientsProfiles/routes/rejectConsentRequestRoute.js
//
// POST /patient-profile/consent-requests/:id/reject
// Body (optional): { note: "string" }
// Sprint 3.2 (Pull Consent).

import express from "express";
import { rejectRequest } from "../controllers/consentRequest.controller.js";

const router = express.Router();

router.post("/:id/reject", rejectRequest);

export default router;
