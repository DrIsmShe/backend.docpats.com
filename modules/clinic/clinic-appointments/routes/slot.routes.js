// server/modules/clinic/clinic-appointments/routes/slot.routes.js
//
// Route for the free-slot lookup endpoint.
//
// Mounted by clinic-appointments/index.js on "/" (each sub-router owns its
// own prefix internally — see the index.js header note). Full path behind
// /api/v1/clinic:
//
//   GET /appointments/slots?doctorId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// AUTH / TENANT: tenantMiddleware runs upstream in clinic/index.js.
//
// AUDIT: slots are not PHI — they describe when a doctor works, not
// anything about a patient. But for a complete forensic picture of who
// queried scheduling data we audit reads too, consistent with
// clinic.schedule.view. metaFrom carries only the query parameters
// (doctorId + window bounds) — all structural, nothing sensitive.
//
// resourceId = the doctorId being queried (from the query string, via a
// function resolver — auditMiddleware's resourceIdFrom supports both
// string paths and functions).

import express from "express";

import { getSlots } from "../controllers/slot.controller.js";
import { auditMiddleware } from "../../../audit/middleware/auditMiddleware.js";

const router = express.Router();

// ─── Free-slot lookup ─────────────────────────────────────────
router.get(
  "/slots",
  auditMiddleware({
    resourceType: "clinic-doctor-schedule",
    action: "clinic.schedule.slots.view",
    resourceIdFrom: (req) => req.query?.doctorId || null,
    metaFrom: (req) => ({
      doctorId: req.query?.doctorId ?? null,
      from: req.query?.from ?? null,
      to: req.query?.to ?? null,
    }),
  }),
  getSlots,
);

export default router;
