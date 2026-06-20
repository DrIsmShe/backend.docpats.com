// server/modules/clinic/clinic-staff/routes/membershipRequest.routes.js
//
// Routes for MembershipRequest (Variant 2). Mounted in clinic/index.js via
// router.use("/", membershipRequestRouter) — so full /membership-requests and
// /my-membership-requests prefixes live here.
//
// tenantMiddleware({ required: false }) already ran on the parent. Owner
// endpoints rely on clinic context (the service calls getCurrentClinicId and
// throws if absent). Doctor endpoints use the session userId only and query
// with skipTenantScope, so they work without a clinic context.

import express from "express";
import * as ctrl from "../controllers/membershipRequest.controller.js";

const router = express.Router();

// ─── Owner side (tenant-scoped) ──────────────────────────────────
router.get("/membership-requests", ctrl.listClinicRequestsController);
router.post("/membership-requests", ctrl.createRequestController);
router.delete("/membership-requests/:id", ctrl.cancelRequestController);

// ─── Doctor side (own invitations, no clinic context) ────────────
router.get("/my-membership-requests", ctrl.listMyRequestsController);
router.post("/my-membership-requests/:id/accept", ctrl.acceptRequestController);
router.post("/my-membership-requests/:id/reject", ctrl.rejectRequestController);

export default router;
