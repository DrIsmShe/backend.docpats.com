// server/modules/clinic/clinic-staff/myMemberships.js
//
// "My clinics" for a DocPats doctor: the clinics where the logged-in user is
// an active member. Unlike the rest of clinic-staff, this is NOT tenant-scoped
// — the doctor asks about *themselves* before any clinic context is chosen, so
// it runs under authMiddleware only and queries memberships by session userId.
//
// Self-contained (service + controller + router) to keep the change small.
// Mounted in clinic/index.js: router.use("/", myMembershipsRouter)
//   → GET /api/v1/clinic/my-memberships

import express from "express";
import ClinicMembership from "./models/clinicMembership.model.js";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import logger from "../../../common/logger.js";

const log = logger.child({ module: "clinic-staff/my-memberships" });

// ─── Service ────────────────────────────────────────────────────
export async function listMyMemberships(userId) {
  if (!userId) return [];

  // Active memberships of THIS user across all clinics.
  // skipTenantScope: this query intentionally crosses clinic boundaries.
  const memberships = await ClinicMembership.find(
    { userId, leftAt: null },
    null,
    { skipTenantScope: true },
  )
    .sort({ isPrimary: -1, joinedAt: -1 })
    .lean();

  if (memberships.length === 0) return [];

  // Resolve clinic display info.
  const Clinic = (await import("../clinic-core/models/clinic.model.js"))
    .default;
  const clinicIds = memberships.map((m) => m.clinicId);
  const clinics = await Clinic.find({ _id: { $in: clinicIds } }, null, {
    skipTenantScope: true,
  })
    .select("_id name slug logo city")
    .lean();

  const clinicMap = new Map(clinics.map((c) => [String(c._id), c]));

  return memberships.map((m) => {
    const c = clinicMap.get(String(m.clinicId)) || {};
    return {
      membershipId: String(m._id),
      clinicId: String(m.clinicId),
      clinicName: c.name || null,
      clinicSlug: c.slug || null,
      clinicLogo: c.logo || null,
      clinicCity: c.city || null,
      role: m.role,
      customTitle: m.customTitle || null,
      isPrimary: !!m.isPrimary,
      joinedAt: m.joinedAt,
    };
  });
}

// ─── Controller ─────────────────────────────────────────────────
const listMyMembershipsController = asyncHandler(async (req, res) => {
  const userId = req.userId || req.user?.userId || req.session?.userId;
  const items = await listMyMemberships(userId);
  res.json({ items, count: items.length });
});

// ─── Router ─────────────────────────────────────────────────────
const router = express.Router();
router.get("/my-memberships", authMiddleware, listMyMembershipsController);

export default router;
