// server/modules/patientsProfiles/routes/approveConsentRequestRoute.js
//
// POST /patient-profile/consent-requests/:id/approve
// Body (optional): { approvedScopes: { encounters, allergies, ... } }
// Sprint 3.2 (Pull Consent).

import express from "express";
import { approveRequest } from "../controllers/consentRequest.controller.js";

const router = express.Router();

router.post("/:id/approve", approveRequest);

export default router;
