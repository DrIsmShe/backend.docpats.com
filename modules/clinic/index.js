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
import clinicPatientRouter from "./clinic-patients/routes/patient.routes.js";
import clinicConsentRequestRouter from "./clinic-patients/routes/consentRequest.routes.js";
import clinicAppointmentsRouter from "./clinic-appointments/index.js";
import clinicReviewModerationRouter from "./clinic-core/routes/clinicReviewModeration.routes.js";
// РІвЂќР‚РІвЂќР‚РІвЂќР‚ UMR / clinic-medical (Sprint 2 Phase 2B + 2C) РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚
// Aggregator: encounter CRUD + 5 sub-record routers (allergies, chronic,
// operations, family history, immunization). imaging deferred to 2C.2.
import clinicMedicalRouter from "./clinic-medical/index.js";
import { tenantMiddleware } from "../../common/middlewares/tenantMiddleware.js";
import clinicPharmacyRouter from "./clinic-pharmacy/index.js"; // NEW
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
import clinicDepartmentRouter from "./clinic-departments/index.js";
import clinicRoomRouter from "./clinic-rooms/index.js";
import clinicEquipmentRouter from "./clinic-equipment/index.js";
import clinicKnowledgeRouter from "./clinic-knowledge/index.js";
import clinicAnnouncementsRouter from "./clinic-announcements/index.js";
import clinicAnalyticsRouter from "./clinic-analytics/index.js";
import clinicLeadsRouter from "./clinic-leads/index.js";
import myMembershipsRouter from "./clinic-staff/myMemberships.js";
import "./clinic-staff/events/staff.listeners.js";
import clinicConsiliumRouter from "./clinic-consilium/index.js";
import clinicTelemedRouter from "./clinic-telemed/index.js";
import membershipRequestRouter from "./clinic-staff/routes/membershipRequest.routes.js";
import clinicMediaRouter from "./clinic-core/routes/clinicMedia.routes.js";
import clinicServiceRouter from "./clinic-services/index.js";
// V4.2 РІР‚вЂќ Р СР С•Р Т‘Р ВµР В»РЎРЉ РЎС“РЎРѓР В»РЎС“Р С– (Р Т‘Р В»РЎРЏ /me: РЎвЂЎР ВµР С”Р В±Р С•Р С”РЎРѓ Р’В«Р Р€РЎРѓР В»РЎС“Р С–Р С‘Р’В» Р Р† РЎР‚Р ВµР Т‘Р В°Р С”РЎвЂљР С•РЎР‚Р Вµ Р Р†Р С‘РЎвЂљРЎР‚Р С‘Р Р…РЎвЂ№).
import ClinicService from "./clinic-services/models/clinicService.model.js";
import clinicMembershipInviteRouter from "./clinic-staff/routes/clinicMembershipInvite.routes.js";

const router = express.Router();

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
// 1. Employee auth routes РІР‚вЂќ MOUNTED BEFORE tenantMiddleware
//    so /login can run without an auth context.
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’

router.use("/", clinicEmployeeAuthRouter);

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
// 2. tenantMiddleware РІР‚вЂќ РЎС“РЎРѓРЎвЂљР В°Р Р…Р В°Р Р†Р В»Р С‘Р Р†Р В°Р ВµРЎвЂљ context Р С‘Р В· session.userId/employeeId
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’

router.use(tenantMiddleware({ required: false }));

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
// 3. Built-in endpoints
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’

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
        role: req.session?.role || null,
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
        "name slug tier timezone defaultCurrency defaultLanguage supportedLanguages isVerified description isPublished logo gallery theme layout coverImage slogan callCenterPhone callCenterHours faq pageBackground",
      )
      .lean();

    // V4.2 РІР‚вЂќ РЎС“РЎРѓР В»РЎС“Р С–Р С‘ Р С”Р В»Р С‘Р Р…Р С‘Р С”Р С‘ (Р Т‘Р В»РЎРЏ РЎР‚Р ВµР Т‘Р В°Р С”РЎвЂљР С•РЎР‚Р В° Р Р†Р С‘РЎвЂљРЎР‚Р С‘Р Р…РЎвЂ№: РЎвЂЎР ВµР С”Р В±Р С•Р С”РЎРѓ Р’В«Р Р€РЎРѓР В»РЎС“Р С–Р С‘Р’В» Р Р† NavForm
    // Р С—Р С•Р С”Р В°Р В·РЎвЂ№Р Р†Р В°Р ВµРЎвЂљРЎРѓРЎРЏ РЎвЂљР С•Р В»РЎРЉР С”Р С• Р С”Р С•Р С–Р Т‘Р В° РЎС“ Р С”Р В»Р С‘Р Р…Р С‘Р С”Р С‘ Р ВµРЎРѓРЎвЂљРЎРЉ РЎвЂ¦Р С•РЎвЂљРЎРЏ Р В±РЎвЂ№ Р С•Р Т‘Р Р…Р В° РЎС“РЎРѓР В»РЎС“Р С–Р В°).
    const clinicServices = await ClinicService.find({
      clinicId,
      status: "active",
      isSystem: { $ne: true },
    })
      .select("_id name departmentId priceType price")
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
            description: clinic.description || "",
            isPublished: clinic.isPublished === true,
            logo: clinic.logo || null,
            gallery: Array.isArray(clinic.gallery)
              ? clinic.gallery
                  .slice()
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                  .map((g) => ({
                    id: String(g._id),
                    url: g.url,
                    caption: g.caption || "",
                    order: g.order ?? 0,
                  }))
              : [],
            theme: clinic.theme || {},
            layout: clinic.layout || { blocks: [] },
            coverImage: clinic.coverImage || null,
            pageBackground: clinic.pageBackground || null,
            slogan: clinic.slogan || "",
            callCenterPhone: clinic.callCenterPhone || "",
            callCenterHours: clinic.callCenterHours || "",
            faq: Array.isArray(clinic.faq) ? clinic.faq : [],
            // V4.2 РІР‚вЂќ РЎС“РЎРѓР В»РЎС“Р С–Р С‘ (Р Т‘Р В»РЎРЏ РЎР‚Р ВµР Т‘Р В°Р С”РЎвЂљР С•РЎР‚Р В° Р Р†Р С‘РЎвЂљРЎР‚Р С‘Р Р…РЎвЂ№ Р С‘ nav). Р С›Р В±Р В»Р ВµР С–РЎвЂЎРЎвЂР Р…Р Р…РЎвЂ№Р в„– DTO.
            services: Array.isArray(clinicServices)
              ? clinicServices.map((s) => ({
                  id: String(s._id),
                  name: s.name,
                  departmentId: s.departmentId ? String(s.departmentId) : null,
                  priceType: s.priceType,
                  price: typeof s.price === "number" ? s.price : null,
                }))
              : [],
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

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
// 4. Submodule routes (protected by tenantMiddleware above)
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
router.use("/", clinicReviewModerationRouter);
router.use("/", clinicCoreRouter);
router.use("/", clinicMediaRouter);
router.use("/", clinicStaffRouter);
router.use("/", clinicDepartmentRouter);
router.use("/", clinicServiceRouter);
router.use("/", clinicRoomRouter);
router.use("/", clinicEquipmentRouter);
router.use("/", clinicKnowledgeRouter);
router.use("/", clinicAnnouncementsRouter);
router.use("/", clinicAnalyticsRouter);
router.use("/", clinicLeadsRouter);
router.use("/", clinicPharmacyRouter);
router.use("/", myMembershipsRouter);
router.use("/", clinicInvitationRouter);
router.use("/", clinicPatientRouter);
router.use("/", clinicConsiliumRouter);
router.use("/", clinicTelemedRouter);
router.use("/", clinicConsentRequestRouter);
router.use("/", membershipRequestRouter);
router.use("/appointments", clinicAppointmentsRouter);
// UMR / clinic-medical РІР‚вЂќ encounter + sub-records, mounted under /medical
router.use("/medical", clinicMedicalRouter);
router.use("/", clinicMembershipInviteRouter);
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
// 5. 404 + error handler
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’

router.use(notFoundHandler);
router.use(errorHandler);

export default router;
