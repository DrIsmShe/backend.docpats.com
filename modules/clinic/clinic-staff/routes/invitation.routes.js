// modules/clinic/clinic-staff/routes/invitation.routes.js
//
// Routes for clinic staff invitations.
// Mounted under /api/v1/clinic in the parent index.js.
//
// PUBLIC routes (no auth, no tenant context):
//   GET  /invitations/preview        — preview an invitation by token
//   POST /invitations/request-otp    — generate + send OTP
//   POST /invitations/accept         — finalize registration
//
// AUTHENTICATED routes (require session + clinic context):
//   POST   /invitations              — create new invitation
//   GET    /invitations              — list pending invitations
//   DELETE /invitations/:id          — revoke pending invitation

import express from "express";
import * as ctrl from "../controllers/invitation.controller.js";

const router = express.Router();

// ─── Public ─────────────────────────────────────────────────────
router.get("/invitations/preview", ctrl.previewInvitation);
router.post("/invitations/request-otp", ctrl.requestOtp);
router.post("/invitations/accept", ctrl.acceptInvitation);

// ─── Authenticated ──────────────────────────────────────────────
router.post("/invitations", ctrl.createInvitation);
router.get("/invitations", ctrl.listInvitations);
router.delete("/invitations/:id", ctrl.revokeInvitation);

export default router;
