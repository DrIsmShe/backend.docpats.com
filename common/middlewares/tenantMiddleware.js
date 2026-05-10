// server/common/middlewares/tenantMiddleware.js
//
// Express middleware that establishes the tenant context for the request.
//
// MUST be mounted AFTER session middleware so req.session.userId / employeeId
// is available.
// MUST be mounted BEFORE clinic-* routes so they have context.
//
// Behavior:
//   1. If no session → continue without context (public routes work fine).
//   2. If session.userId → resolve active clinic membership for User.
//   3. If session.employeeId → resolve clinic directly from ClinicEmployee.
//   4. Wrap the rest of the request lifecycle in runWithTenantContext.
//   5. Also expose { userId, clinicId, role, permissions, actorType } as
//      req.tenantContext for backwards compatibility with code that prefers
//      req-based access.
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

      // Employee branch — internal clinic staff
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

      // User branch — public DocPats user (existing behaviour, untouched)
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
      runWithTenantContext(ctx, () => next());
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
