// server/modules/clinic/clinic-staff/controllers/membershipRequest.controller.js
//
// Controllers for MembershipRequest (Variant 2: invite-with-confirmation).
//
// Owner side (tenant-scoped, runs after tenantMiddleware):
//   POST   /membership-requests           createRequestController
//   GET    /membership-requests           listClinicRequestsController
//   DELETE /membership-requests/:id        cancelRequestController
//
// Doctor side (authMiddleware only — own invitations across clinics):
//   GET    /my-membership-requests         listMyRequestsController
//   POST   /my-membership-requests/:id/accept  acceptRequestController
//   POST   /my-membership-requests/:id/reject  rejectRequestController

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  createRequest,
  listMyRequests,
  acceptRequest,
  rejectRequest,
  cancelRequest,
  listClinicRequests,
} from "../services/membershipRequest.service.js";

function getUserId(req) {
  return req.userId || req.user?.userId || req.session?.userId;
}

// ─── Owner side ──────────────────────────────────────────────────
export const createRequestController = asyncHandler(async (req, res) => {
  const { userId, role, customTitle, employmentType } = req.body || {};
  if (!userId) throw new ValidationError("userId is required");
  if (!role) throw new ValidationError("role is required");
  const request = await createRequest({
    userId,
    role,
    customTitle,
    employmentType,
  });
  res.status(201).json({ request });
});

export const listClinicRequestsController = asyncHandler(async (req, res) => {
  const items = await listClinicRequests();
  res.json({ items, count: items.length });
});

export const cancelRequestController = asyncHandler(async (req, res) => {
  const result = await cancelRequest(req.params.id);
  res.json(result);
});

// ─── Doctor side ─────────────────────────────────────────────────
export const listMyRequestsController = asyncHandler(async (req, res) => {
  const items = await listMyRequests(getUserId(req));
  res.json({ items, count: items.length });
});

export const acceptRequestController = asyncHandler(async (req, res) => {
  const result = await acceptRequest(getUserId(req), req.params.id);
  res.json(result);
});

export const rejectRequestController = asyncHandler(async (req, res) => {
  const result = await rejectRequest(getUserId(req), req.params.id);
  res.json(result);
});
