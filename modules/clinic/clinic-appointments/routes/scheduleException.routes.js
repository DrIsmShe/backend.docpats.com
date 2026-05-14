// server/modules/clinic/clinic-appointments/routes/scheduleException.routes.js
//
// Routes for the schedule-exception sub-resource.
//
// Mounted by clinic-appointments/index.js on "/" (same as
// doctorSchedule.routes.js — each sub-router owns its own path prefix
// internally). Full paths behind /api/v1/clinic:
//
//   POST   /appointments/exceptions/:doctorId               → create one
//   POST   /appointments/exceptions/:doctorId/bulk-day-off  → vacation range
//   GET    /appointments/exceptions/:doctorId?from=&to=     → list in window
//   DELETE /appointments/exceptions/entry/:exceptionId      → delete one
//
// ROUTE ORDER — load-bearing here:
//   "/exceptions/:doctorId/bulk-day-off" must be registered BEFORE
//   "/exceptions/:doctorId" so Express matches the more specific path
//   first. And the DELETE uses "/exceptions/entry/:exceptionId" — a
//   distinct segment ("entry") — so it can never be shadowed by the
//   ":doctorId" param routes. Both precautions follow the clinic module's
//   "specific routes before parameterized" convention.
//
// AUTH / TENANT: tenantMiddleware runs upstream in clinic/index.js.
//
// AUDIT: every endpoint wrapped in auditMiddleware. A doctor's day-off is
// not PHI, but WHO changed availability and WHEN is security-relevant
// (availability tampering, forensic timeline). metaFrom carries only
// structural metadata — dates, counts, type — never anything sensitive.

import express from "express";

import {
  postException,
  postBulkDayOff,
  getExceptions,
  deleteExceptionEntry,
} from "../controllers/scheduleException.controller.js";

import { auditMiddleware } from "../../../audit/middleware/auditMiddleware.js";

const router = express.Router();

// ─── Bulk day-off (vacation range) ────────────────────────────────────
// MUST be registered before "/exceptions/:doctorId" — more specific path.
// resourceId = the doctor whose availability is being changed.
// metaFrom: the date range + note presence — NOT enumerated days.
router.post(
  "/exceptions/:doctorId/bulk-day-off",
  auditMiddleware({
    resourceType: "clinic-doctor-schedule",
    action: "clinic.schedule.exception.bulk_day_off",
    resourceIdFrom: "params.doctorId",
    metaFrom: (req) => ({
      startDate: req.body?.startDate ?? null,
      endDate: req.body?.endDate ?? null,
      hasNote: Boolean(req.body?.note),
    }),
  }),
  postBulkDayOff,
);

// ─── Create one exception ─────────────────────────────────────────────
// resourceId = the doctor. metaFrom: which date, what type, how many
// intervals (for "custom") — structural only.
router.post(
  "/exceptions/:doctorId",
  auditMiddleware({
    resourceType: "clinic-doctor-schedule",
    action: "clinic.schedule.exception.create",
    resourceIdFrom: "params.doctorId",
    metaFrom: (req) => ({
      date: req.body?.date ?? null,
      type: req.body?.type ?? null,
      intervalCount: Array.isArray(req.body?.intervals)
        ? req.body.intervals.length
        : 0,
      hasNote: Boolean(req.body?.note),
    }),
  }),
  postException,
);

// ─── List exceptions in a date window ─────────────────────────────────
// resourceId = the doctor. metaFrom: the requested window bounds.
router.get(
  "/exceptions/:doctorId",
  auditMiddleware({
    resourceType: "clinic-doctor-schedule",
    action: "clinic.schedule.exception.list",
    resourceIdFrom: "params.doctorId",
    metaFrom: (req) => ({
      from: req.query?.from ?? null,
      to: req.query?.to ?? null,
    }),
  }),
  getExceptions,
);

// ─── Delete one exception by its own id ───────────────────────────────
// Distinct "/entry/:exceptionId" segment — cannot collide with :doctorId
// routes. resourceId = the exception's own id.
router.delete(
  "/exceptions/entry/:exceptionId",
  auditMiddleware({
    resourceType: "clinic-doctor-schedule",
    action: "clinic.schedule.exception.delete",
    resourceIdFrom: "params.exceptionId",
  }),
  deleteExceptionEntry,
);

export default router;
