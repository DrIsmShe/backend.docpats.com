// modules/clinic/clinic-staff/controllers/clinicMembershipInvite.controller.js
//
// HTTP controllers for User-backed clinic membership invitations (admins).
//
// Authenticated + tenant-scoped (owner zone): create / list / revoke.
//   Gated on staff.write / staff.read. Because admin has STAFF=RO in the RBAC
//   matrix, staff.write is effectively owner-only — exactly who may add an admin.
// Public: preview (token in query).
// Authenticated, NO tenant context: accept (the accepting user is logged in but
//   not yet a member of the target clinic). New users register via the link and
//   the registration controller calls the same service.acceptInvitation().
//
// AUDIT (HIPAA §164.312(b)):
//   create / accept / revoke / list are audited via recordActionAsync directly
//   in the controller (not middleware). create & accept resourceIds only exist
//   AFTER the service call (invite._id / membership._id), which is exactly the
//   imaging/patient pattern. list is a collection action (audit.service
//   whitelists *.list — no resourceId needed). Both success and failure paths
//   are recorded so broken/denied attempts stay visible.
//
//   PHI safety: metadata carries only role / structural flags — NEVER the
//   invited email, names, or the token.

import * as inviteService from "../services/clinicMembershipInvite.service.js";
import auditService from "../../../audit/services/audit.service.js";
import {
  createMembershipInvitationSchema,
  previewMembershipTokenSchema,
  acceptMembershipInvitationSchema,
  membershipInviteIdParamSchema,
} from "../validators/invitation.schemas.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
  getCurrentRole,
} from "../../../../common/context/tenantContext.js";
import { can } from "../../../../common/auth/can.js";
import {
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
} from "../../../../common/utils/errors.js";

const RESOURCE_TYPE = "clinic-membership-invite";

function requireActor() {
  const userId = getCurrentUserId();
  const clinicId = getCurrentClinicId();
  if (!userId || !clinicId) {
    throw new UnauthorizedError("Authentication and clinic context required");
  }
  return { userId, clinicId, role: getCurrentRole() };
}

function requireAuthUser() {
  const userId = getCurrentUserId();
  if (!userId) throw new UnauthorizedError("Authentication required");
  return userId;
}

function parseOrThrow(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError("Invalid input", { issues: result.error.issues });
  }
  return result.data;
}

/* ═══════════ AUDIT HELPERS ═══════════
   Inline copies of extractActor / extractContext (auditMiddleware does not
   export them). Same logic as patient.controller.js — supports req.user,
   clinic session userId, and employee session. Keep in sync if the middleware
   extractors evolve.
*/

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

// ─── Authenticated + tenant-scoped (owner zone) ─────────────────

export async function createInvitation(req, res, next) {
  const auditActor = extractActor(req);
  try {
    const actor = requireActor();
    if (!can("staff", "write")) {
      throw new ForbiddenError("staff.write permission required");
    }

    const data = parseOrThrow(createMembershipInvitationSchema, req.body);

    const { invite, emailSent } = await inviteService.createInvitation({
      ...data,
      actor: {
        userId: actor.userId,
        role: actor.role,
        clinicId: actor.clinicId,
      },
    });

    if (auditActor) {
      auditService.recordActionAsync({
        actor: auditActor,
        action: "clinic.membership_invite.create",
        resourceType: RESOURCE_TYPE,
        resourceId: String(invite._id),
        outcome: "success",
        metadata: { role: invite.role, emailSent }, // NO email/PII
        context: extractContext(req, 201),
      });
    }

    res.status(201).json({
      invitation: invite.toJSON(), // toJSON transform hides emailEncrypted+tokenHash
      emailSent,
    });
  } catch (err) {
    if (auditActor) {
      try {
        auditService.recordActionAsync({
          actor: auditActor,
          action: "clinic.membership_invite.create",
          resourceType: RESOURCE_TYPE,
          resourceId: null,
          outcome: "failure",
          failureReason: err?.message?.slice(0, 500) || "unknown",
          metadata: { role: req.body?.role || null },
          context: extractContext(req, err?.statusCode || 500),
        });
      } catch (auditErr) {
        console.warn(
          "[audit] membership-invite create-failure record failed:",
          auditErr.message,
        );
      }
    }
    next(err);
  }
}

export async function listInvitations(req, res, next) {
  const auditActor = extractActor(req);
  try {
    const actor = requireActor();
    if (!can("staff", "read")) {
      throw new ForbiddenError("staff.read permission required");
    }

    const status = req.query.status || "pending";
    const invitations = await inviteService.listInvitations({
      clinicId: actor.clinicId,
      status,
    });

    if (auditActor) {
      auditService.recordActionAsync({
        actor: auditActor,
        action: "clinic.membership_invite.list", // *.list — no resourceId required
        resourceType: RESOURCE_TYPE,
        outcome: "success",
        metadata: { status, count: invitations.length },
        context: extractContext(req, 200),
      });
    }

    res.json({ invitations });
  } catch (err) {
    next(err);
  }
}

export async function revokeInvitation(req, res, next) {
  const auditActor = extractActor(req);
  const { id } = req.params;
  try {
    const actor = requireActor();
    if (!can("staff", "write")) {
      throw new ForbiddenError("staff.write permission required");
    }

    const { inviteId } = parseOrThrow(membershipInviteIdParamSchema, {
      inviteId: id,
    });

    const invitation = await inviteService.revokeInvitation({
      inviteId,
      actor: { userId: actor.userId, clinicId: actor.clinicId },
    });

    if (auditActor) {
      auditService.recordActionAsync({
        actor: auditActor,
        action: "clinic.membership_invite.revoke",
        resourceType: RESOURCE_TYPE,
        resourceId: String(invitation.id),
        outcome: "success",
        context: extractContext(req, 200),
      });
    }

    res.json({ invitation });
  } catch (err) {
    if (auditActor) {
      try {
        auditService.recordActionAsync({
          actor: auditActor,
          action: "clinic.membership_invite.revoke",
          resourceType: RESOURCE_TYPE,
          resourceId: id && /^[a-f\d]{24}$/i.test(id) ? String(id) : null,
          outcome: "failure",
          failureReason: err?.message?.slice(0, 500) || "unknown",
          context: extractContext(req, err?.statusCode || 500),
        });
      } catch (auditErr) {
        console.warn(
          "[audit] membership-invite revoke-failure record failed:",
          auditErr.message,
        );
      }
    }
    next(err);
  }
}

// ─── Public (no auth, no tenant context) ────────────────────────

export async function previewInvitation(req, res, next) {
  try {
    const data = parseOrThrow(previewMembershipTokenSchema, {
      token: req.query.token,
    });

    const preview = await inviteService.getInvitationPreview({
      token: data.token,
    });

    res.json(preview);
  } catch (err) {
    next(err);
  }
}

// ─── Authenticated, NO tenant context ───────────────────────────
// The accepting user is logged in but not yet a member of the target clinic.
// If unauthenticated, the frontend routes the person to registration with
// ?invite=<token>; the registration controller then calls the same service.

export async function acceptInvitation(req, res, next) {
  const auditActor = extractActor(req);
  try {
    const userId = requireAuthUser();
    const data = parseOrThrow(acceptMembershipInvitationSchema, req.body);

    const result = await inviteService.acceptInvitation({
      token: data.token,
      userId,
    });

    if (auditActor) {
      auditService.recordActionAsync({
        actor: auditActor,
        action: "clinic.membership_invite.accept",
        resourceType: RESOURCE_TYPE,
        resourceId: String(result.membershipId), // membership is the created resource
        outcome: "success",
        metadata: { role: result.role, alreadyMember: result.alreadyMember }, // NO email/PII
        context: extractContext(req, 200),
      });
    }

    res.status(200).json({
      ...result,
      message: result.alreadyMember
        ? "You are already a member of this clinic."
        : "Invitation accepted. Membership created.",
    });
  } catch (err) {
    if (auditActor) {
      try {
        auditService.recordActionAsync({
          actor: auditActor,
          action: "clinic.membership_invite.accept",
          resourceType: RESOURCE_TYPE,
          resourceId: null,
          outcome: "failure",
          failureReason: err?.message?.slice(0, 500) || "unknown",
          context: extractContext(req, err?.statusCode || 500),
        });
      } catch (auditErr) {
        console.warn(
          "[audit] membership-invite accept-failure record failed:",
          auditErr.message,
        );
      }
    }
    next(err);
  }
}
