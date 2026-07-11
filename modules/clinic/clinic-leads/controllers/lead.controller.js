// server/modules/clinic/clinic-leads/controllers/lead.controller.js
//
// HTTP controllers for clinic leads.
//
// Split by trust level:
//   • submitLead — PUBLIC. No auth, no tenant context. The clinic is
//     identified by :slug in the path; the service resolves it (published
//     only). This is what the vitrina contact form calls.
//   • listLeads / updateLeadStatus — PRIVATE (manager zone). Guarded by
//     requirePermission(lead.read / lead.write). clinicId comes from the ALS
//     tenant context; the handler never trusts a client-supplied clinicId.
//
// Style mirrors analytics.controller.js / department.controller.js:
// asyncHandler wraps each handler, errors flow to the central errorHandler.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import {
  getCurrentClinicId,
  getCurrentMembershipId,
} from "../../../../common/context/tenantContext.js";
import { ForbiddenError } from "../../../../common/utils/errors.js";
import {
  require as requirePermission,
  ACTIONS,
} from "../../../../common/auth/can.js";
import { RESOURCES } from "../../../../common/auth/permissions.js";
import * as leadService from "../services/lead.service.js";

// ── helpers ───────────────────────────────────────────────
function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ForbiddenError("No active clinic context");
  return clinicId;
}

// ── PUBLIC: POST /api/v1/public/clinics/:slug/leads ───────
export const submitLead = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { name, phone, message, type } = req.body || {};

  const lead = await leadService.createLead({
    slug,
    name,
    phone,
    message,
    type,
  });

  res.status(201).json({
    ok: true,
    leadId: String(lead._id),
    status: lead.status,
  });
});

// ── PRIVATE: GET /api/v1/clinic/leads ─────────────────────
export const listLeads = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.LEAD, ACTIONS.READ);

  const clinicId = requireClinicId();
  const { status, limit, skip } = req.query;

  const result = await leadService.listLeads({ clinicId, status, limit, skip });

  res.json(result);
});

// ── PRIVATE: PATCH /api/v1/clinic/leads/:leadId ───────────
export const updateLeadStatus = asyncHandler(async (req, res) => {
  requirePermission(RESOURCES.LEAD, ACTIONS.WRITE);

  const clinicId = requireClinicId();
  const { leadId } = req.params;
  const { status, note } = req.body || {};

  const lead = await leadService.updateLeadStatus({
    clinicId,
    leadId,
    status,
    note,
    membershipId: getCurrentMembershipId(),
  });

  res.json({ lead });
});