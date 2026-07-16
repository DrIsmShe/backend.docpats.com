// server/modules/clinic/clinic-departments/routes/department.routes.js
//
// REST endpoints for ClinicDepartment management (clinic org structure).
//
// Mount path (from parent clinic router): /api/v1/clinic/*
// Final URLs:
//   GET    /api/v1/clinic/departments
//   POST   /api/v1/clinic/departments
//   GET    /api/v1/clinic/departments/:id
//   PATCH  /api/v1/clinic/departments/:id
//   PATCH  /api/v1/clinic/departments/:id/head
//   DELETE /api/v1/clinic/departments/:id          (soft archive)
//
// AUTH / TENANT:
//   authMiddleware + tenantContext are applied UPSTREAM on the parent
//   clinic router (same as staff.routes.js). This file assumes
//   req.tenantContext.clinicId is already populated.
//
// AUDIT (intentionally NOT applied here — see note):
//   Unlike staff.routes.js, department endpoints are NOT written to
//   hipaa_audit_logs. Staff routes are audited because they expose
//   DECRYPTED PII (names/emails) and grant access to PHI. Departments
//   contain no PII/PHI — only org-structure config (name, code,
//   specialty). Logging them would pollute the HIPAA audit trail with
//   non-PHI noise.
//
//   If org-structure forensics is wanted later ("who assigned the head
//   of Neurology", "who archived a department"), add a SEPARATE
//   non-HIPAA audit channel on the write routes — do not mix into
//   hipaa_audit_logs.

import express from "express";
import * as ctrl from "../controllers/department.controller.js";
import { requireClinicPerm } from "../../../../common/middlewares/requireClinicPerm.js";

const router = express.Router();

// RBAC через requireClinicPerm("department", ...). Раньше проверки не было —
// любая роль могла править структуру отделений.

// ─── List departments ─────────────────────────────────────────────────
// Query: status, branchId, specialty, parentDepartmentId, q
router.get("/departments", requireClinicPerm("department", "read"), ctrl.listDepartments);

// ─── Create department ─────────────────────────────────────────────────
router.post("/departments", requireClinicPerm("department", "write"), ctrl.createDepartment);

// ─── Get one ──────────────────────────────────────────────────────────
router.get("/departments/:id", requireClinicPerm("department", "read"), ctrl.getDepartment);

// ─── Update ───────────────────────────────────────────────────────────
router.patch("/departments/:id", requireClinicPerm("department", "write"), ctrl.updateDepartment);

// ─── Set / unset head (заведующий отделением) ─────────────────────────
// Body: { headMembershipId: <id|null> }  — null снимает заведующего.
router.patch("/departments/:id/head", requireClinicPerm("department", "write"), ctrl.setDepartmentHead);

// ─── Archive (soft delete) ────────────────────────────────────────────
// System "General" department cannot be archived (service enforces).
router.delete("/departments/:id", requireClinicPerm("department", "delete"), ctrl.archiveDepartment);

export default router;
