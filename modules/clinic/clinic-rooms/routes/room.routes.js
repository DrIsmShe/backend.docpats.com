// server/modules/clinic/clinic-rooms/routes/room.routes.js
//
// REST endpoints for ClinicRoom management (clinic org structure — rooms
// belong to departments).
//
// Mount path (from parent clinic router): /api/v1/clinic/*
// Final URLs:
//   GET    /api/v1/clinic/rooms                list (?departmentId &status)
//   POST   /api/v1/clinic/rooms                create
//   GET    /api/v1/clinic/rooms/:id            detail
//   PATCH  /api/v1/clinic/rooms/:id            update
//   DELETE /api/v1/clinic/rooms/:id            soft archive
//
// AUTH / TENANT:
//   authMiddleware + tenantMiddleware are applied UPSTREAM on the parent
//   clinic router (clinic/index.js). By the time we reach these handlers
//   getCurrentClinicId() is populated. RBAC is enforced in the service
//   layer via requirePerm("room", ...) — exactly like clinic-departments.
//
// AUDIT (intentionally NOT applied — same rationale as departments):
//   Rooms hold no PII/PHI (name, code, floor, capacity, assigned member
//   ids). Logging them would pollute hipaa_audit_logs with non-PHI noise.
//   If org-structure forensics is wanted later, add a SEPARATE non-HIPAA
//   audit channel — do not mix into hipaa_audit_logs.

import express from "express";
import * as ctrl from "../controllers/room.controller.js";

const router = express.Router();

// ─── List rooms ───────────────────────────────────────────────────────
// Query: departmentId, status
router.get("/rooms", ctrl.listRoomsController);

// ─── Create room ──────────────────────────────────────────────────────
router.post("/rooms", ctrl.createRoomController);

// ─── Get one ──────────────────────────────────────────────────────────
router.get("/rooms/:id", ctrl.getRoomController);

// ─── Update ───────────────────────────────────────────────────────────
router.patch("/rooms/:id", ctrl.updateRoomController);

// ─── Archive (soft delete) ────────────────────────────────────────────
router.delete("/rooms/:id", ctrl.archiveRoomController);

export default router;
