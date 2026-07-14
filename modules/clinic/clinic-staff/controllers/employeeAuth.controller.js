// modules/clinic/clinic-staff/controllers/employeeAuth.controller.js
//
// HTTP controllers for ClinicEmployee authentication (Global Clinic Worker).
// Public: login. Authenticated: logout, me, selectClinic.
//
// Session model (Variant B, path-based MVP):
// A single browser session can hold BOTH a DocPats user identity
// (req.session.userId) and a ClinicEmployee identity (req.session.employeeId)
// side-by-side — they serve different routes and never conflict.
//
// Multi-clinic: a worker is one global identity that may belong to several
// clinics. Login authenticates the identity; the ACTIVE clinic is stored in
// req.session.clinicId. When a worker belongs to exactly one clinic we select
// it automatically; when several, the client picks one via /select-clinic.
// Employee login only ADDS employeeId/clinicId to the session (never touches
// userId), so we do NOT regenerate the session.

import * as authService from "../services/employeeAuth.service.js";
import { loginSchema } from "../validators/employeeAuth.schemas.js";
import {
  ValidationError,
  UnauthorizedError,
} from "../../../../common/utils/errors.js";
import { getEffectivePermissions } from "../../../../common/auth/permissions.js";

function parseOrThrow(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError("Invalid input", { issues: result.error.issues });
  }
  return result.data;
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

// Build the full "you are in this clinic" payload from a membership summary
// (as returned by listEmployeeMemberships / loginEmployee) — its `clinic`
// field is already a full clinic-context DTO (core + витрина), built via
// authService.toClinicContextDTO in the service layer.
function activeClinicPayload(employeeDTO, membershipSummary) {
  return {
    employee: employeeDTO,
    clinic: membershipSummary.clinic,
    role: membershipSummary.role,
    permissions: getEffectivePermissions(
      membershipSummary.role,
      membershipSummary.permissions,
    ),
    needsClinicSelection: false,
  };
}

// Build the same payload from full docs (employee doc + clinic doc + membership).
// clinic is passed through the SAME DTO helper as the login path so the shape
// (core + витрина fields) is identical for /me and /select-clinic.
function activeClinicPayloadFromDocs(employee, clinic, membership) {
  return {
    employee: authService.employeeToDTO(employee),
    clinic: authService.toClinicContextDTO(clinic),
    role: membership.role,
    permissions: getEffectivePermissions(
      membership.role,
      membership.permissions,
    ),
    needsClinicSelection: false,
  };
}

function clinicSelectionPayload(employeeDTO, memberships) {
  return {
    employee: employeeDTO,
    needsClinicSelection: true,
    clinics: memberships.map((m) => ({
      clinicId: m.clinicId,
      role: m.role,
      clinic: m.clinic,
    })),
  };
}

// ─── POST /login ──────────────────────────────────────────────

export async function login(req, res, next) {
  try {
    const data = parseOrThrow(loginSchema, req.body);

    const { employee, memberships } = await authService.loginEmployee({
      email: data.email,
      password: data.password,
      // Контекст для HIPAA-аудита: кто, откуда, каким браузером.
      context: {
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        sessionId: req.sessionID,
      },
    });

    const employeeDTO = authService.employeeToDTO(employee);

    if (req.session) {
      req.session.employeeId = String(employee._id);
      // Auto-select when there is exactly one clinic; otherwise clear any
      // stale selection so the client is forced to pick.
      if (memberships.length === 1) {
        req.session.clinicId = memberships[0].clinicId;
      } else {
        delete req.session.clinicId;
      }
      await saveSession(req);
    }

    if (memberships.length === 1) {
      return res.json(activeClinicPayload(employeeDTO, memberships[0]));
    }

    // Multiple clinics → client shows a picker, then calls /select-clinic.
    return res.json(clinicSelectionPayload(employeeDTO, memberships));
  } catch (err) {
    next(err);
  }
}

// ─── POST /select-clinic ──────────────────────────────────────
//
// Choose which clinic to work in for this session (multi-clinic workers).

export async function selectClinic(req, res, next) {
  try {
    const employeeId = req.session?.employeeId;
    if (!employeeId) {
      throw new UnauthorizedError("Not authenticated");
    }

    const clinicId = req.body?.clinicId;
    if (!clinicId) {
      throw new ValidationError("clinicId is required");
    }

    // getEmployeeWithClinic throws if there is no active membership in that
    // clinic — so this both validates access and loads the context.
    const { employee, clinic, membership } =
      await authService.getEmployeeWithClinic(employeeId, clinicId);

    req.session.clinicId = String(clinicId);
    await saveSession(req);

    res.json(activeClinicPayloadFromDocs(employee, clinic, membership));
  } catch (err) {
    next(err);
  }
}

// ─── POST /logout ─────────────────────────────────────────────
//
// Remove ONLY the employee identity (employeeId + selected clinicId) from the
// session. Keep userId (the DocPats user identity) intact.

export async function logout(req, res, next) {
  try {
    if (!req.session) {
      return res.json({ success: true });
    }

    delete req.session.employeeId;
    delete req.session.clinicId;

    await saveSession(req);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ─── GET /me ──────────────────────────────────────────────────

export async function me(req, res, next) {
  try {
    const employeeId = req.session?.employeeId;
    if (!employeeId) {
      throw new UnauthorizedError("Not authenticated");
    }

    let clinicId = req.session?.clinicId;

    // No clinic chosen yet (fresh multi-clinic session, or selection lost).
    if (!clinicId) {
      const memberships = await authService.listEmployeeMemberships(employeeId);
      if (memberships.length === 0) {
        throw new UnauthorizedError(
          "You are not a member of any active clinic",
        );
      }
      if (memberships.length === 1) {
        // Auto-select the only clinic and persist it.
        clinicId = memberships[0].clinicId;
        req.session.clinicId = clinicId;
        await saveSession(req);
      } else {
        // Several clinics → ask the client to pick.
        // employeeToDTO needs the identity doc; load it via the first clinic
        // only to decrypt PII (role/permissions are per-clinic, not used here).
        const { employee } = await authService.getEmployeeWithClinic(
          employeeId,
          memberships[0].clinicId,
        );
        return res.json(
          clinicSelectionPayload(
            authService.employeeToDTO(employee),
            memberships,
          ),
        );
      }
    }

    const { employee, clinic, membership } =
      await authService.getEmployeeWithClinic(employeeId, clinicId);

    res.json(activeClinicPayloadFromDocs(employee, clinic, membership));
  } catch (err) {
    next(err);
  }
}
