// server/modules/clinic/clinic-staff/controllers/membershipRequest.controller.js
//
// Controllers for MembershipRequest (Variant 2: invite-an-existing-User with
// confirmation). Hardened to mirror clinicMembershipInvite.controller.js:
//
//   • Owner-side create/list/cancel are GATED on staff.write / staff.read via
//     can(). Because admin has STAFF=RO in the RBAC matrix, staff.write is
//     effectively owner-only — exactly who may invite an admin. (Variant A:
//     the whole path is owner-only. If a manager must later invite doctors,
//     relax with a role-aware branch — see createRequestController.)
//   • Role is validated against INVITABLE_MEMBERSHIP_ROLES (admin/doctor).
//     Employee roles (nurse/receptionist/accountant/pharmacist/marketer/
//     manager) are ClinicEmployees and go through the OTP invitation path,
//     NOT here. "owner" is excluded — a clinic has exactly one.
//   • employmentType is an employee-only concept; forced null for admin.
//   • create / accept / reject / cancel / list are audited (HIPAA §164.312(b))
//     via recordActionAsync directly in the controller — resourceId for create
//     only exists after the service call. Both success and failure paths are
//     recorded. PHI safety: metadata carries only role / structural flags.
//
// ⚠ DEPLOY ORDER: auditEnums.js must first register
//   clinic.membership_request.{create,accept,reject,cancel,list,expire}
//   + resourceType "clinic-membership-request", or the audit service will
//   reject these actions (non-blocking: fire-and-forget + try/catch, so the
//   request still succeeds — but the audit row is lost).
//
// Owner side (tenant-scoped, after tenantMiddleware — clinic context present):
//   POST   /membership-requests            createRequestController
//   GET    /membership-requests            listClinicRequestsController
//   DELETE /membership-requests/:id        cancelRequestController
//
// User side (authMiddleware only — own invitations, NO clinic context, so
// can() must NOT be called here; ownership is enforced by the service query
// { _id, userId, status:"pending" }):
//   GET    /my-membership-requests             listMyRequestsController
//   POST   /my-membership-requests/:id/accept  acceptRequestController
//   POST   /my-membership-requests/:id/reject  rejectRequestController

import { z } from "zod";

import auditService from "../../../audit/services/audit.service.js";
import { can } from "../../../../common/auth/can.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
  getCurrentRole,
} from "../../../../common/context/tenantContext.js";
import {
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
} from "../../../../common/utils/errors.js";
import {
  createRequest,
  listMyRequests,
  acceptRequest,
  rejectRequest,
  cancelRequest,
  listClinicRequests,
} from "../services/membershipRequest.service.js";

const RESOURCE_TYPE = "clinic-membership-request";

// User-backed membership roles invitable via this path (actorType:"user").
export const INVITABLE_MEMBERSHIP_ROLES = ["admin", "doctor"];

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const createRequestSchema = z
  .object({
    userId: objectId,
    role: z.enum(INVITABLE_MEMBERSHIP_ROLES),
    customTitle: z.string().trim().max(200).optional().default(""),
    employmentType: z.string().max(50).nullish(),
  })
  .transform((d) => ({
    ...d,
    // employmentType is employee-only; strip it for admin memberships.
    employmentType: d.role === "admin" ? null : (d.employmentType ?? null),
  }));

const requestIdParamSchema = z.object({ id: objectId });

// ─── helpers ─────────────────────────────────────────────────────

function getUserId(req) {
  return req.userId || req.user?.userId || req.session?.userId;
}

function requireActor() {
  const userId = getCurrentUserId();
  const clinicId = getCurrentClinicId();
  if (!userId || !clinicId) {
    throw new UnauthorizedError("Authentication and clinic context required");
  }
  return { userId, clinicId, role: getCurrentRole() };
}

function requireAuthUser(req) {
  const userId = getUserId(req);
  if (!userId) throw new UnauthorizedError("Authentication required");
  return String(userId);
}

function parseOrThrow(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError("Invalid input", { issues: result.error.issues });
  }
  return result.data;
}

/* Inline copies of extractActor / extractContext (auditMiddleware does not
   export them). Same logic as clinicMembershipInvite.controller.js — supports
   req.user, clinic session userId, and employee session. Keep in sync. */

function extractActor(req) {
  if (req.actor?.userId) return req.actor;

  if (req.user) {
    const userId =
      req.user._id?.toString?.() ||
      req.user.userId?.toString?.() ||
      req.userId?.toString?.();
    if (userId) {
      return {
        userId,
        email: req.user.email || req.session?.email || null,
        role: req.user.role || req.session?.role || null,
      };
    }
  }

  if (req.session?.userId) {
    return {
      userId: String(req.session.userId),
      email:
        req.session.email || req.session.userEmail || req.user?.email || null,
      role: req.session.role || req.session.userRole || null,
    };
  }

  if (req.session?.employeeId) {
    return {
      userId: String(req.session.employeeId),
      email: req.session.employeeEmail || null,
      role: req.session.employeeRole || null,
    };
  }

  return null;
}

function extractContext(req, statusCode) {
  if (req.context) {
    return {
      ...req.context,
      httpMethod: req.method,
      httpPath: req.originalUrl || req.url,
      statusCode,
    };
  }

  return {
    ipAddress:
      req.ip ||
      req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.connection?.remoteAddress ||
      null,
    userAgent: req.headers?.["user-agent"] || null,
    sessionId: req.sessionID || null,
    requestId: req.id || null,
    httpMethod: req.method,
    httpPath: req.originalUrl || req.url,
    statusCode,
  };
}

function auditSafe(payload) {
  try {
    auditService.recordActionAsync(payload);
  } catch (auditErr) {
    console.warn(
      `[audit] membership-request ${payload?.action} record failed:`,
      auditErr.message,
    );
  }
}

// ─── Owner side (tenant-scoped) ──────────────────────────────────

export async function createRequestController(req, res, next) {
  const auditActor = extractActor(req);
  try {
    requireActor();
    // Variant A: owner-only for the whole path. admin has STAFF=RO, so
    // staff.write can only be true for the owner. (To later allow a manager
    // to invite doctors: branch here on parsed role.)
    if (!can("staff", "write")) {
      throw new ForbiddenError("staff.write permission required");
    }

    const data = parseOrThrow(createRequestSchema, req.body || {});

    const request = await createRequest(data);

    if (auditActor) {
      auditSafe({
        actor: auditActor,
        action: "clinic.membership_request.create",
        resourceType: RESOURCE_TYPE,
        resourceId: String(request._id),
        outcome: "success",
        metadata: { role: request.role }, // NO PII
        context: extractContext(req, 201),
      });
    }

    res.status(201).json({ request });
  } catch (err) {
    if (auditActor) {
      auditSafe({
        actor: auditActor,
        action: "clinic.membership_request.create",
        resourceType: RESOURCE_TYPE,
        resourceId: null,
        outcome: "failure",
        failureReason: err?.message?.slice(0, 500) || "unknown",
        metadata: { role: req.body?.role || null },
        context: extractContext(req, err?.statusCode || 500),
      });
    }
    next(err);
  }
}

export async function listClinicRequestsController(req, res, next) {
  const auditActor = extractActor(req);
  try {
    requireActor();
    if (!can("staff", "read")) {
      throw new ForbiddenError("staff.read permission required");
    }

    const items = await listClinicRequests();

    if (auditActor) {
      auditSafe({
        actor: auditActor,
        action: "clinic.membership_request.list", // *.list — no resourceId needed
        resourceType: RESOURCE_TYPE,
        outcome: "success",
        metadata: { count: items.length },
        context: extractContext(req, 200),
      });
    }

    res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
}

export async function cancelRequestController(req, res, next) {
  const auditActor = extractActor(req);
  const { id } = req.params;
  try {
    requireActor();
    if (!can("staff", "write")) {
      throw new ForbiddenError("staff.write permission required");
    }

    const { id: requestId } = parseOrThrow(requestIdParamSchema, { id });
    const result = await cancelRequest(requestId);

    if (auditActor) {
      auditSafe({
        actor: auditActor,
        action: "clinic.membership_request.cancel",
        resourceType: RESOURCE_TYPE,
        resourceId: String(requestId),
        outcome: "success",
        context: extractContext(req, 200),
      });
    }

    res.json(result);
  } catch (err) {
    if (auditActor) {
      auditSafe({
        actor: auditActor,
        action: "clinic.membership_request.cancel",
        resourceType: RESOURCE_TYPE,
        resourceId: id && /^[a-f\d]{24}$/i.test(id) ? String(id) : null,
        outcome: "failure",
        failureReason: err?.message?.slice(0, 500) || "unknown",
        context: extractContext(req, err?.statusCode || 500),
      });
    }
    next(err);
  }
}

// ─── User side (own invitations, no clinic context) ──────────────

export async function listMyRequestsController(req, res, next) {
  try {
    const items = await listMyRequests(requireAuthUser(req));
    res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
}

export async function acceptRequestController(req, res, next) {
  const auditActor = extractActor(req);
  const { id } = req.params;
  try {
    const userId = requireAuthUser(req);
    const { id: requestId } = parseOrThrow(requestIdParamSchema, { id });

    const result = await acceptRequest(userId, requestId);

    if (auditActor) {
      auditSafe({
        actor: auditActor,
        action: "clinic.membership_request.accept",
        resourceType: RESOURCE_TYPE,
        resourceId: String(requestId),
        outcome: "success",
        context: extractContext(req, 200),
      });
    }

    res.json(result);
  } catch (err) {
    if (auditActor) {
      auditSafe({
        actor: auditActor,
        action: "clinic.membership_request.accept",
        resourceType: RESOURCE_TYPE,
        resourceId: id && /^[a-f\d]{24}$/i.test(id) ? String(id) : null,
        outcome: "failure",
        failureReason: err?.message?.slice(0, 500) || "unknown",
        context: extractContext(req, err?.statusCode || 500),
      });
    }
    next(err);
  }
}

export async function rejectRequestController(req, res, next) {
  const auditActor = extractActor(req);
  const { id } = req.params;
  try {
    const userId = requireAuthUser(req);
    const { id: requestId } = parseOrThrow(requestIdParamSchema, { id });

    const result = await rejectRequest(userId, requestId);

    if (auditActor) {
      auditSafe({
        actor: auditActor,
        action: "clinic.membership_request.reject",
        resourceType: RESOURCE_TYPE,
        resourceId: String(requestId),
        outcome: "success",
        context: extractContext(req, 200),
      });
    }

    res.json(result);
  } catch (err) {
    if (auditActor) {
      auditSafe({
        actor: auditActor,
        action: "clinic.membership_request.reject",
        resourceType: RESOURCE_TYPE,
        resourceId: id && /^[a-f\d]{24}$/i.test(id) ? String(id) : null,
        outcome: "failure",
        failureReason: err?.message?.slice(0, 500) || "unknown",
        context: extractContext(req, err?.statusCode || 500),
      });
    }
    next(err);
  }
}
