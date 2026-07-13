// server/common/middlewares/tenantMiddleware.js
//
// Express middleware that establishes the tenant context for the request.
//
// MUST be mounted AFTER session middleware so req.session.userId / employeeId
// is available.
// MUST be mounted BEFORE clinic-* routes so they have context.
//
// ── Identity priority (IMPORTANT) ────────────────────────────────
// A single browser session can hold BOTH a DocPats user identity
// (req.session.userId) AND a ClinicEmployee identity
// (req.session.employeeId) at the same time — e.g. a clinic owner who
// also did a staff-login. These two identities serve DIFFERENT zones:
//
//   • Owner / DocPats-user zone  → /clinic/*
//   • Employee zone              → /clinic/employee/* (and /clinic/employees/*
//                                   auth endpoints)
//
// Because the USER identity must win whenever both ids are present
// (otherwise an owner who also logged in as staff would be resolved with the
// employee role across the whole owner zone), we resolve userId FIRST and
// only fall back to employeeId when there is no userId in the session.
//
// ── ClinicEmployee is a GLOBAL identity (multi-clinic) ────────────
// A ClinicEmployee is ONE global identity that may belong to several clinics
// via ClinicMembership. The ACTIVE clinic for the request lives in
// req.session.clinicId (set at login / via /select-clinic). We therefore
// resolve the employee's membership using the SESSION clinicId — NOT a
// clinicId on the employee document (there is none). The effective
// permissions (role defaults merged with per-membership overrides) are put
// into the context so server-side can()/require() work in the employee zone.
//
// Behavior:
//   1. No session → continue without context (public routes work fine).
//   2. session.userId present → resolve active clinic membership for User
//      (takes priority even if employeeId is also present).
//   3. Only employeeId present → resolve membership for the SELECTED clinic
//      (req.session.clinicId) from ClinicMembership.
//   4. Wrap the rest of the request lifecycle in runWithTenantContext.
//   5. Also expose the context as req.tenantContext for req-based access.
//
// Note: for ClinicEmployee, the `userId` field of the context holds the
// ClinicEmployee._id. Distinguish via `actorType: "employee"` when needed.

import mongoose from "mongoose";
import { runWithTenantContext } from "../context/tenantContext.js";
import { resolveActiveClinic } from "../services/clinicResolver.service.js";
import ClinicEmployee from "../../modules/clinic/clinic-staff/models/clinicEmployee.model.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";
import { getEffectivePermissions } from "../auth/permissions.js";
import logger from "../logger.js";

const log = logger.child({ module: "tenantMiddleware" });

/**
 * Express middleware factory.
 * Use options.required = true to reject requests without a clinic context.
 */
export function tenantMiddleware(options = {}) {
  const { required = false } = options;

  return async function tenantMiddlewareImpl(req, res, next) {
    try {
      const userId = req.session?.userId;
      const employeeId = req.session?.employeeId;

      // 1. No identity at all → public route, no context.
      if (!userId && !employeeId) {
        return next();
      }

      // ── User branch — takes priority when both ids are present ──
      // When both userId and employeeId are present in the session, the
      // USER identity wins for the owner zone. (The employee zone has its
      // own /clinic/employee/* routes; those requests carry employeeId and,
      // when there is no userId, fall through to the employee branch below.)
      if (userId) {
        const requestedClinicId =
          req.headers["x-clinic-id"] || req.query?.clinicId || undefined;

        const active = await resolveActiveClinic(userId, requestedClinicId);
        if (!active) {
          if (required) {
            return res.status(403).json({
              error: "No active clinic membership",
              code: "NO_CLINIC_MEMBERSHIP",
            });
          }
          const ctx = { userId, actorType: "user" };
          req.tenantContext = ctx;
          return runWithTenantContext(ctx, () => next());
        }

        const ctx = {
          userId,
          clinicId: String(active.clinicId),
          role: active.role,
          permissions: active.permissions,
          membershipId: String(active.membershipId),
          actorType: "user",
        };
        req.tenantContext = ctx;
        return runWithTenantContext(ctx, () => next());
      }

      // ── Employee branch — only when there is NO userId ──
      // Pure employee session (staff-login without a DocPats user logged in).
      // Resolve the membership for the SELECTED clinic (session.clinicId).
      if (employeeId) {
        const sessionClinicId = req.session?.clinicId;
        const ctx = await resolveEmployeeContext(employeeId, sessionClinicId);
        if (!ctx) {
          if (required) {
            return res.status(403).json({
              error: "Employee account not active or no clinic selected",
              code: "EMPLOYEE_INACTIVE",
            });
          }
          return next();
        }
        req.tenantContext = ctx;
        return runWithTenantContext(ctx, () => next());
      }

      // Unreachable (either userId or employeeId was present), but keep a
      // safe fallthrough.
      return next();
    } catch (err) {
      log.error(
        {
          err,
          userId: req.session?.userId,
          employeeId: req.session?.employeeId,
        },
        "tenantMiddleware error",
      );
      next(err);
    }
  };
}

/**
 * Resolve the tenant context for a ClinicEmployee.
 *
 * A ClinicEmployee is a GLOBAL identity — it has NO clinicId on the model.
 * The active clinic is the one selected for this session (session.clinicId),
 * so we look up the membership by (employeeId, sessionClinicId). Without a
 * selected clinic we cannot resolve a role → return null (caller decides
 * whether that's a hard 403; the client should call /select-clinic first).
 *
 * The context carries EFFECTIVE permissions (role defaults merged with any
 * per-membership overrides) so server-side can()/require() resolve correctly
 * in the employee zone — same as the user branch.
 *
 * @param {string} employeeId
 * @param {string} [sessionClinicId]
 * @returns {Promise<object|null>}
 */
async function resolveEmployeeContext(employeeId, sessionClinicId) {
  if (!mongoose.isValidObjectId(employeeId)) return null;
  if (!sessionClinicId || !mongoose.isValidObjectId(sessionClinicId)) {
    // No clinic selected in this session → cannot resolve role/permissions.
    return null;
  }

  const employee = await ClinicEmployee.findById(employeeId).lean();
  if (!employee) return null;
  if (employee.isPlatformDeleted) return null;
  if (employee.isActive === false) return null;

  // Membership for the SELECTED clinic (global identity → per-clinic membership).
  const membership = await ClinicMembership.findOne({
    userId: employee._id,
    clinicId: sessionClinicId,
    actorType: "employee",
    isActive: true,
    leftAt: null,
  }).lean();

  if (!membership) {
    log.warn(
      { employeeId: String(employee._id), clinicId: String(sessionClinicId) },
      "Employee has no active membership in the selected clinic — auth rejected",
    );
    return null;
  }

  return {
    userId: String(employee._id), // employee id acts as actor id
    clinicId: String(sessionClinicId),
    role: membership.role,
    // EFFECTIVE permissions (role defaults + per-membership overrides), so the
    // server-side can()/require() see site_builder/marketing/etc. from the
    // role even when the membership has no explicit override for them.
    permissions: getEffectivePermissions(
      membership.role,
      membership.permissions,
    ),
    membershipId: String(membership._id),
    actorType: "employee",
  };
}
