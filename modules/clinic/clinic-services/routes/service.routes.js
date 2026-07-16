// server/modules/clinic/clinic-services/routes/service.routes.js
//
// REST endpoints for ClinicService management (clinic price-list / услуги).
//
// Mount path (from parent clinic router): /api/v1/clinic/*
// Final URLs:
//   GET    /api/v1/clinic/services
//   POST   /api/v1/clinic/services
//   GET    /api/v1/clinic/services/:id
//   PATCH  /api/v1/clinic/services/:id
//   DELETE /api/v1/clinic/services/:id          (soft archive)
//
// AUTH / TENANT:
//   authMiddleware + tenantContext применяются UPSTREAM на родительском
//   clinic-роутере (как department.routes.js). Здесь предполагается, что
//   tenant-контекст уже установлен (getCurrentClinicId вернёт clinicId).
//
// AUDIT (намеренно НЕ применяется — как departments):
//   Услуги — это конфиг прайса (name/price/description), без PII/PHI.
//   Логировать их в hipaa_audit_logs = засорять HIPAA-трейл не-PHI шумом.
//   Если позже нужна форензика прайса — отдельный не-HIPAA канал на write-роуты.

import express from "express";
import * as ctrl from "../controllers/service.controller.js";
import { requireClinicPerm } from "../../../../common/middlewares/requireClinicPerm.js";

const router = express.Router();

// RBAC: прайс правят owner/admin/manager (ресурс "service"). Раньше проверки
// не было — любой сотрудник мог переписать прайс-лист. Чтение открыто всем
// членам клиники (регистратор/врач должны видеть цены).

// ─── List services ────────────────────────────────────────
// Query: status, departmentId, branchId, q
router.get("/services", ctrl.listServices);

// ─── Create service ───────────────────────────────────────
router.post("/services", requireClinicPerm("service", "write"), ctrl.createService);

// ─── Get one ──────────────────────────────────────────────
router.get("/services/:id", ctrl.getService);

// ─── Update ───────────────────────────────────────────────
router.patch("/services/:id", requireClinicPerm("service", "write"), ctrl.updateService);

// ─── Archive (soft delete) ────────────────────────────────
// System service cannot be archived (service-layer enforces).
router.delete("/services/:id", requireClinicPerm("service", "delete"), ctrl.archiveService);

export default router;
