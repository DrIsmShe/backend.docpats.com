// modules/clinic/clinic-staff/routes/clinicMembershipInvite.routes.js
//
// Routes for User-backed clinic membership invitations (admins).
// Mounted under /api/v1/clinic in the parent clinic index.js via
//   router.use("/", clinicMembershipInviteRouter)
// so the full /membership-invitations/* prefix lives here.
//
// Security is enforced INSIDE the controllers (requireActor / requireAuthUser /
// can()), mirroring invitation.routes.js — the parent's
// tenantMiddleware({ required: false }) only populates context when a session
// (and, for owner endpoints, a clinic) is present. No per-route auth middleware.
//
// PUBLIC (no auth, no tenant context):
//   GET  /membership-invitations/preview   — preview an invite by token
//
// AUTHENTICATED, NO tenant context (logged-in user accepting an invite to a
// clinic they are not yet a member of):
//   POST /membership-invitations/accept    — accept + create membership
//
// AUTHENTICATED + tenant-scoped (owner zone; controller gates on staff.write/read):
//   POST   /membership-invitations          — create invite (owner-only in practice)
//   GET    /membership-invitations          — list invites
//   DELETE /membership-invitations/:id       — revoke invite
//
// Route order: static paths (preview, accept) before the parameterized :id route.

import express from "express";
import * as ctrl from "../controllers/clinicMembershipInvite.controller.js";

const router = express.Router();

// ─── Public ─────────────────────────────────────────────────────
router.get("/membership-invitations/preview", ctrl.previewInvitation);

// ─── Authenticated, no tenant context ───────────────────────────
router.post("/membership-invitations/accept", ctrl.acceptInvitation);

// ─── Authenticated + tenant-scoped (owner zone) ─────────────────
router.post("/membership-invitations", ctrl.createInvitation);
router.get("/membership-invitations", ctrl.listInvitations);
router.delete("/membership-invitations/:id", ctrl.revokeInvitation);

export default router;
