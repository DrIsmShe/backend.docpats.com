// server/modules/patientsProfiles/routes/listConsentRequestsRoute.js
//
// GET /patient-profile/consent-requests
// Returns: { items: ConsentRequest[], count: number }
// Sprint 3.2 (Pull Consent).

import express from "express";
import { listMyPendingRequests } from "../controllers/consentRequest.controller.js";

const router = express.Router();

router.get("/", listMyPendingRequests);

export default router;
