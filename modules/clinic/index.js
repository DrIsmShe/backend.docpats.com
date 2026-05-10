// server/modules/clinic/index.js
//
// Main router for ALL clinic-* submodules.
// Mounted at /api/v1/clinic/* in main index.js.

import express from "express";
import Clinic from "./clinic-core/models/clinic.model.js";
import clinicCoreRouter from "./clinic-core/routes/clinic.routes.js";
import clinicStaffRouter from "./clinic-staff/routes/staff.routes.js";
import clinicInvitationRouter from "./clinic-staff/routes/invitation.routes.js";
import clinicEmployeeAuthRouter from "./clinic-staff/routes/employeeAuth.routes.js";
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
// 1. Employee auth routes — MOUNTED BEFORE tenantMiddleware
//    so /login can run without an auth context.
// ═══════════════════════════════════════════════════════════════

router.use("/", clinicEmployeeAuthRouter);

// ═══════════════════════════════════════════════════════════════
// 2. tenantMiddleware — устанавливает context из session.userId/employeeId
// ═══════════════════════════════════════════════════════════════

router.use(tenantMiddleware({ required: false }));

// ═══════════════════════════════════════════════════════════════
// 3. Built-in endpoints
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/v1/clinic/me
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

    const features = await getEnabledFeatures(clinicId);

    const clinic = await Clinic.findById(clinicId)
      .select(
        "name slug tier timezone defaultCurrency defaultLanguage supportedLanguages isVerified",
      )
      .lean();

    res.json({
      authenticated: true,
      hasClinic: true,
      userId: String(userId),
      clinicId: String(clinicId),
      role,
      membershipId: getCurrentMembershipId(),
      permissions: effectivePermissions,
      features: Array.from(features),
      clinic: clinic
        ? {
            id: String(clinic._id),
            name: clinic.name,
            slug: clinic.slug,
            tier: clinic.tier,
            timezone: clinic.timezone,
            defaultCurrency: clinic.defaultCurrency,
            defaultLanguage: clinic.defaultLanguage,
            supportedLanguages: clinic.supportedLanguages,
            isVerified: clinic.isVerified,
          }
        : null,
    });
  }),
);

/**
 * GET /api/v1/clinic/me/memberships
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
// 4. Submodule routes (protected by tenantMiddleware above)
// ═══════════════════════════════════════════════════════════════

router.use("/", clinicCoreRouter);
router.use("/", clinicStaffRouter);
router.use("/", clinicInvitationRouter);

// ═══════════════════════════════════════════════════════════════
// 5. 404 + error handler
// ═══════════════════════════════════════════════════════════════

router.use(notFoundHandler);
router.use(errorHandler);

export default router;
