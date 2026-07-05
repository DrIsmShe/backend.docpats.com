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
//   • Owner / DocPats-user zone  → /clinic/*        (this middleware)
//   • Employee zone              → /clinic/employees/* (reads employeeId
//                                   directly in its own controllers; it
//                                   does NOT depend on this middleware)
//
// Because this middleware only backs the owner/user zone, the USER
// identity must win whenever both ids are present. Otherwise an owner
// who also logged in as staff would be resolved with the employee role
// across the whole owner zone. We therefore resolve userId FIRST and
// only fall back to employeeId when there is no userId in the session.
//
// Behavior:
//   1. No session → continue without context (public routes work fine).
//   2. session.userId present → resolve active clinic membership for User
//      (takes priority even if employeeId is also present).
//   3. Only employeeId present → resolve clinic from ClinicEmployee.
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

      // No auth at all
      if (!userId && !employeeId) {
        if (required) {
          return res.status(401).json({
            error: "Authentication required",
            code: "UNAUTHORIZED",
          });
        }
        return next();
      }

      // ── User branch — DocPats user identity takes PRIORITY ──
      // When both userId and employeeId are present in the session, the
      // owner/user identity wins in this (owner-zone) middleware. The
      // employee zone has its own /employees/* routes that read employeeId
      // directly, so employee auth never depends on this middleware.
      if (userId) {
        const headerClinicId = req.headers["x-clinic-id"];
        const paramClinicId = req.params?.clinicId;
        const requestedClinicId = headerClinicId || paramClinicId || null;

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
      // Pure employee session (staff-login without a DocPats user logged
      // in). Resolve the clinic context from the ClinicEmployee.
      if (employeeId) {
        const ctx = await resolveEmployeeContext(employeeId);
        if (!ctx) {
          if (required) {
            return res.status(403).json({
              error: "Employee account not active",
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
 * Employees belong to exactly one clinic (by design), so we don't need
 * the multi-clinic resolution logic that Users have.
 *
 * @param {string} employeeId
 * @returns {Promise<object|null>}  context object or null if not active
 */
async function resolveEmployeeContext(employeeId) {
  if (!mongoose.isValidObjectId(employeeId)) return null;

  const employee = await ClinicEmployee.findById(employeeId).lean();
  if (!employee) return null;
  if (employee.isDeleted) return null;
  if (employee.isActive === false) return null;

  // Find the corresponding membership (created at invitation accept time)
  const membership = await ClinicMembership.findOne({
    userId: employee._id,
    clinicId: employee.clinicId,
    actorType: "employee",
    isActive: true,
    leftAt: null,
  }).lean();

  if (!membership) {
    log.warn(
      { employeeId: String(employee._id), clinicId: String(employee.clinicId) },
      "Employee has no active membership — auth rejected",
    );
    return null;
  }

  return {
    userId: String(employee._id), // employee id acts as actor id
    clinicId: String(employee.clinicId),
    role: membership.role,
    permissions: membership.permissions || {},
    membershipId: String(membership._id),
    actorType: "employee",
  };
}
