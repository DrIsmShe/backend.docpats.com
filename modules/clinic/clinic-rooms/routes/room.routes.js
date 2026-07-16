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
//   getCurrentClinicId() is populated.
//
// RBAC: проверяется здесь через requireClinicPerm("room", ...). Ранее комментарий
//   утверждал, что RBAC делается в сервисном слое — это было НЕВЕРНО, в
//   room.service проверки не было вообще (любая роль могла править комнаты).
//   Матрица: read — все роли с доступом; write/delete — admin/manager/owner.
//
// AUDIT (intentionally NOT applied):
//   Rooms hold no PII/PHI (name, code, floor, capacity, assigned member ids).
//   Logging them would pollute hipaa_audit_logs with non-PHI noise.

import express from "express";
import * as ctrl from "../controllers/room.controller.js";
import { requireClinicPerm } from "../../../../common/middlewares/requireClinicPerm.js";

const router = express.Router();

// ─── List rooms ───────────────────────────────────────────────────────
// Query: departmentId, status
router.get("/rooms", requireClinicPerm("room", "read"), ctrl.listRoomsController);

// ─── Create room ──────────────────────────────────────────────────────
router.post("/rooms", requireClinicPerm("room", "write"), ctrl.createRoomController);

// ─── Get one ──────────────────────────────────────────────────────────
router.get("/rooms/:id", requireClinicPerm("room", "read"), ctrl.getRoomController);

// ─── Update ───────────────────────────────────────────────────────────
router.patch("/rooms/:id", requireClinicPerm("room", "write"), ctrl.updateRoomController);

// ─── Archive (soft delete) ────────────────────────────────────────────
router.delete("/rooms/:id", requireClinicPerm("room", "delete"), ctrl.archiveRoomController);

export default router;
