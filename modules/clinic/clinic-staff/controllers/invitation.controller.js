// modules/clinic/clinic-staff/controllers/invitation.controller.js
//
// HTTP controllers for clinic staff invitations.
// Authenticated endpoints (create/list/revoke) read tenant context from req.
// Public endpoints (preview/request-otp/accept) take token from request body.

import * as invitationService from "../services/invitation.service.js";
import {
  createInvitationSchema,
  previewTokenSchema,
  requestOtpSchema,
  acceptInvitationSchema,
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

function requireActor() {
  const userId = getCurrentUserId();
  const clinicId = getCurrentClinicId();
  if (!userId || !clinicId) {
    throw new UnauthorizedError("Authentication and clinic context required");
  }
  return { userId, clinicId, role: getCurrentRole() };
}

function parseOrThrow(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError("Invalid input", { issues: result.error.issues });
  }
  return result.data;
}

// ─── Authenticated endpoints ───────────────────────────────────

export async function createInvitation(req, res, next) {
  try {
    const actor = requireActor();
    if (!can("staff", "write")) {
      throw new ForbiddenError("staff.write permission required");
    }

    const data = parseOrThrow(createInvitationSchema, req.body);

    const { invitation, emailSent } = await invitationService.createInvitation({
      ...data,
      actor: {
        userId: actor.userId,
        role: actor.role,
        clinicId: actor.clinicId,
      },
    });

    res.status(201).json({
      invitation: invitation.toJSON(),
      emailSent,
    });
  } catch (err) {
    next(err);
  }
}

export async function listInvitations(req, res, next) {
  try {
    const actor = requireActor();
    if (!can("staff", "read")) {
      throw new ForbiddenError("staff.read permission required");
    }

    const status = req.query.status || "pending";
    const invitations = await invitationService.listInvitations({
      clinicId: actor.clinicId,
      status,
    });

    res.json({ invitations });
  } catch (err) {
    next(err);
  }
}

export async function revokeInvitation(req, res, next) {
  try {
    const actor = requireActor();
    if (!can("staff", "write")) {
      throw new ForbiddenError("staff.write permission required");
    }

    const invitation = await invitationService.revokeInvitation({
      invitationId: req.params.id,
      actor: { userId: actor.userId, clinicId: actor.clinicId },
    });

    res.json({ invitation: invitation.toJSON() });
  } catch (err) {
    next(err);
  }
}

// ─── Public endpoints (no auth, no tenant context) ─────────────

export async function previewInvitation(req, res, next) {
  try {
    const data = parseOrThrow(previewTokenSchema, {
      token: req.query.token,
    });

    const preview = await invitationService.getInvitationPreview({
      token: data.token,
    });

    res.json(preview);
  } catch (err) {
    next(err);
  }
}

export async function requestOtp(req, res, next) {
  try {
    const data = parseOrThrow(requestOtpSchema, req.body);
    const result = await invitationService.requestOtp({ token: data.token });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function acceptInvitation(req, res, next) {
  try {
    const data = parseOrThrow(acceptInvitationSchema, req.body);
    const { employee } = await invitationService.acceptInvitation(data);

    // Don't auto-login here — Day 4c will handle the login endpoint.
    // Just confirm registration succeeded.
    res.status(201).json({
      employee: employee.toJSON(),
      message: "Registration completed. You can now sign in.",
    });
  } catch (err) {
    next(err);
  }
}
