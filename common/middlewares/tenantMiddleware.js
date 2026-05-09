// server/common/middlewares/tenantMiddleware.js
//
// Express middleware that establishes the tenant context for the request.
//
// MUST be mounted AFTER session middleware so req.session.userId is available.
// MUST be mounted BEFORE clinic-* routes so they have context.
//
// Behavior:
//   1. If no session/userId → continue without context (public routes work fine).
//   2. If userId present → resolve active clinic membership.
//   3. Wrap the rest of the request lifecycle in runWithTenantContext.
//   4. Also expose { userId, clinicId, role, permissions } as req.tenantContext
//      for backwards compatibility with code that prefers req-based access.

import { runWithTenantContext } from "../context/tenantContext.js";
import { resolveActiveClinic } from "../services/clinicResolver.service.js";
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

      if (!userId) {
        if (required) {
          return res.status(401).json({
            error: "Authentication required",
            code: "UNAUTHORIZED",
          });
        }
        // Public route — proceed without context
        return next();
      }

      // ClinicId can come from:
      //   1. Header X-Clinic-Id (multi-clinic users explicitly switching)
      //   2. URL param :clinicId (for /clinic/:clinicId/* routes)
      //   3. Default — user's primary clinic
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
        // User authenticated but no clinic — may still be valid for some routes
        const ctx = { userId };
        req.tenantContext = ctx;
        return runWithTenantContext(ctx, () => next());
      }

      const ctx = {
        userId,
        clinicId: String(active.clinicId),
        role: active.role,
        permissions: active.permissions,
        membershipId: String(active.membershipId),
      };

      // Expose to downstream code via req for those who prefer it
      req.tenantContext = ctx;

      // Wrap rest of request in AsyncLocalStorage
      runWithTenantContext(ctx, () => next());
    } catch (err) {
      log.error({ err, userId: req.session?.userId }, "tenantMiddleware error");
      next(err);
    }
  };
}
