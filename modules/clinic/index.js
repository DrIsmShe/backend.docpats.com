// server/modules/clinic/index.js
//
// Main router for ALL clinic-* submodules.
// Mounted at /api/v1/clinic/* in main index.js.
//
// As we add submodules (clinic-staff, clinic-scheduling, etc.),
// register them here.

import express from "express";
import { tenantMiddleware } from "../../common/middlewares/tenantMiddleware.js";
import {
  errorHandler,
  notFoundHandler,
} from "../../common/middlewares/errorHandler.js";
import { asyncHandler } from "../../common/middlewares/errorHandler.js";

import {
  getCurrentUserId,
  getCurrentClinicId,
  getCurrentRole,
  getCurrentPermissions,
  getCurrentMembershipId,
  getTenantContext,
} from "../../common/context/tenantContext.js";

import { listUserMemberships } from "../../common/services/clinicResolver.service.js";
import { getEnabledFeatures } from "../../common/services/featureFlag.service.js";
import { ROLE_PERMISSIONS } from "../../common/auth/permissions.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// 1. tenantMiddleware — устанавливает context из session.userId
//    Не required: разрешает запросы без активной clinic membership
// ═══════════════════════════════════════════════════════════════

router.use(tenantMiddleware({ required: false }));

// ═══════════════════════════════════════════════════════════════
// 2. Built-in endpoints (доступны всем authenticated users)
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/v1/clinic/me
 *
 * Returns current tenant context: which clinic, what role, what permissions.
 * Used by frontend to render UI based on user's role.
 *
 * Response:
 *   200 OK + context if user has active membership
 *   200 OK + { authenticated: false } if not logged in
 *   200 OK + { authenticated: true, hasClinic: false } if logged in but no clinic
 */
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const userId = getCurrentUserId();

    if (!userId) {
      return res.json({ authenticated: false });
    }

    const clinicId = getCurrentClinicId();
    if (!clinicId) {
      return res.json({
        authenticated: true,
        hasClinic: false,
        userId: String(userId),
      });
    }

    // Effective permissions: role defaults merged with overrides
    const role = getCurrentRole();
    const overridePermissions = getCurrentPermissions();
    const rolePermissions = ROLE_PERMISSIONS[role] || {};

    const effectivePermissions = {};
    const allResources = new Set([
      ...Object.keys(rolePermissions),
      ...Object.keys(overridePermissions),
    ]);

    for (const resource of allResources) {
      const override = overridePermissions[resource];
      const fromRole = rolePermissions[resource];
      effectivePermissions[resource] = override ||
        fromRole || { read: false, write: false, delete: false };
    }

    // Enabled features for this clinic (from tier + overrides)
    const features = await getEnabledFeatures(clinicId);

    res.json({
      authenticated: true,
      hasClinic: true,
      userId: String(userId),
      clinicId: String(clinicId),
      role,
      membershipId: getCurrentMembershipId(),
      permissions: effectivePermissions,
      features: Array.from(features),
    });
  }),
);

/**
 * GET /api/v1/clinic/me/memberships
 *
 * List all clinics the current user belongs to.
 * Used by clinic switcher UI for users in multiple clinics.
 */
router.get(
  "/me/memberships",
  asyncHandler(async (req, res) => {
    const userId = getCurrentUserId();
    if (!userId) {
      return res.status(401).json({
        error: "Not authenticated",
        code: "UNAUTHORIZED",
      });
    }

    const memberships = await listUserMemberships(userId);

    res.json({
      memberships: memberships.map((m) => ({
        membershipId: String(m._id),
        clinicId: String(m.clinicId._id),
        clinicName: m.clinicId.name,
        clinicSlug: m.clinicId.slug,
        clinicTier: m.clinicId.tier,
        role: m.role,
        isPrimary: m.isPrimary,
        joinedAt: m.joinedAt,
      })),
    });
  }),
);

/**
 * GET /api/v1/clinic/health
 *
 * Liveness check for clinic module.
 * Used by ops/monitoring to verify foundation is healthy.
 */
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    module: "clinic",
    foundation: "sprint0-complete",
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Submodule routes — будут регистрироваться здесь по мере
//    готовности (Week 1 onwards)
// ═══════════════════════════════════════════════════════════════

// Example (commented, will be enabled in Week 1):
// import clinicCoreRouter from "./clinic-core/index.js";
// router.use("/clinics", clinicCoreRouter);

// import clinicStaffRouter from "./clinic-staff/index.js";
// router.use("/staff", clinicStaffRouter);

// ═══════════════════════════════════════════════════════════════
// 4. 404 + error handler — должны быть последними
// ═══════════════════════════════════════════════════════════════

router.use(notFoundHandler);
router.use(errorHandler);

export default router;
