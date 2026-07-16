// server/modules/clinic/clinic-appointments/routes/doctorSchedule.routes.js
//
// Routes for the doctor-schedule sub-resource.
//
// Mounted by clinic-appointments/index.js under the appointments base, so
// the full paths (behind /api/v1/clinic) are:
//
//   PUT  /api/v1/clinic/appointments/schedule/:doctorId   → upsert
//   GET  /api/v1/clinic/appointments/schedule/:doctorId   → get one
//   GET  /api/v1/clinic/appointments/schedule             → list all
//
// ROUTE ORDER: the bare "/schedule" list route is registered AFTER the
// "/schedule/:doctorId" routes, but Express matches "/schedule" and
// "/schedule/:doctorId" unambiguously (different path depth), so order is
// not load-bearing here. We still keep the more-specific ones first for
// consistency with the rest of the clinic module.
//
// AUTH / TENANT: tenantMiddleware runs upstream in clinic/index.js — by the
// time a request reaches here, tenant context is set (or the request is
// rejected). Controllers/services read context from tenantContext.
//
// AUDIT: every endpoint is wrapped in auditMiddleware. A doctor's working
// hours are NOT PHI, but WHO changed scheduling config and WHEN is still
// security-relevant (availability tampering, forensic timeline), so we audit
// all three. metaFrom carries only STRUCTURAL metadata — never decrypted
// values (there are none here anyway) — consistent with the PHI-safe rule.

import express from "express";

import {
  putDoctorSchedule,
  getDoctorSchedule,
  listDoctorSchedules,
} from "../controllers/doctorSchedule.controller.js";

import { auditMiddleware } from "../../../audit/middleware/auditMiddleware.js";
import { requireClinicPerm } from "../../../../common/middlewares/requireClinicPerm.js";

const router = express.Router();

// RBAC: раньше сервис проверял лишь НАЛИЧИЕ актора, но не роль — регистратор
// (SCHEDULE: RO), медсестра, бухгалтер могли править расписание врачей.
// Теперь чтение — по "schedule" read, изменение — по "schedule" write.

// ─── List all schedules in the clinic ─────────────────────────────────
// Admin overview. No resourceId (collection-level read).
router.get(
  "/schedule",
  requireClinicPerm("schedule", "read"),
  auditMiddleware({
    resourceType: "clinic",
    action: "clinic.schedule.list",
    metaFrom: (req) => ({
      activeOnly:
        req.query.activeOnly === "true" || req.query.activeOnly === "1",
    }),
  }),
  listDoctorSchedules,
);

// ─── Get one doctor's schedule ────────────────────────────────────────
// resourceId = the doctor whose schedule is being read.
router.get(
  "/schedule/:doctorId",
  requireClinicPerm("schedule", "read"),
  auditMiddleware({
    resourceType: "clinic-doctor-schedule",
    action: "clinic.schedule.view",
    resourceIdFrom: "params.doctorId",
  }),
  getDoctorSchedule,
);

// ─── Upsert (create-or-replace) a doctor's schedule ───────────────────
// resourceId = the doctor whose schedule is being written.
// metaFrom: structural shape of the new schedule — how many weekdays were
// configured, slot/buffer sizes. NOT the intervals themselves (not PHI,
// but no reason to bloat the audit log; counts are enough for forensics).
router.put(
  "/schedule/:doctorId",
  requireClinicPerm("schedule", "write"),
  auditMiddleware({
    resourceType: "clinic-doctor-schedule",
    action: "clinic.schedule.upsert",
    resourceIdFrom: "params.doctorId",
    metaFrom: (req) => {
      const weekly = Array.isArray(req.body?.weeklyHours)
        ? req.body.weeklyHours
        : [];
      return {
        weekdayCount: weekly.length,
        totalIntervals: weekly.reduce(
          (sum, d) =>
            sum + (Array.isArray(d?.intervals) ? d.intervals.length : 0),
          0,
        ),
        slotDurationMinutes: req.body?.slotDurationMinutes ?? null,
        bufferMinutes: req.body?.bufferMinutes ?? null,
        isActive: req.body?.isActive ?? null,
      };
    },
  }),
  putDoctorSchedule,
);

export default router;
