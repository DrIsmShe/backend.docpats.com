// server/common/services/clinicResolver.service.js
//
// Resolves "which clinic is this user currently working with?".
// Used by tenantMiddleware on every request.

import mongoose from "mongoose";
import ClinicMembership from "../../modules/clinic/clinic-staff/clinicMembership.model.js";
import logger from "../logger.js";

const log = logger.child({ module: "clinicResolver" });

/**
 * Resolve the active clinic for a user.
 *
 * Logic:
 *   1. If `requestedClinicId` is given, verify the user has an active
 *      membership for that clinic.
 *   2. Otherwise, return the user's primary membership.
 *   3. If user has no active memberships, return null.
 *
 * @param {string|ObjectId} userId
 * @param {string} [requestedClinicId]  Optional — clinicId from header/url
 * @returns {Promise<object|null>}  { membershipId, clinicId, role, permissions }
 */
export async function resolveActiveClinic(userId, requestedClinicId = null) {
  if (!userId) return null;

  const query = {
    userId,
    leftAt: null,
    isActive: true,
  };

  if (requestedClinicId && mongoose.isValidObjectId(requestedClinicId)) {
    query.clinicId = requestedClinicId;
  }

  // Sort: primary first, then most recent
  const membership = await ClinicMembership.findOne(query)
    .sort({ isPrimary: -1, joinedAt: -1 })
    .lean();

  if (!membership) {
    if (requestedClinicId) {
      log.debug(
        { userId: String(userId), requestedClinicId },
        "No membership found for requested clinic",
      );
    }
    return null;
  }

  // Convert Map permissions back to plain object for context
  let permissions = {};
  if (membership.permissions) {
    if (membership.permissions instanceof Map) {
      permissions = Object.fromEntries(membership.permissions);
    } else if (typeof membership.permissions === "object") {
      permissions = membership.permissions;
    }
  }

  return {
    membershipId: membership._id,
    clinicId: membership.clinicId,
    role: membership.role,
    permissions,
  };
}

/**
 * List all active memberships for a user (used by clinic switcher UI).
 * @param {string|ObjectId} userId
 * @returns {Promise<Array>}
 */
export async function listUserMemberships(userId) {
  if (!userId) return [];

  return ClinicMembership.find({
    userId,
    leftAt: null,
    isActive: true,
  })
    .populate("clinicId", "name slug tier")
    .sort({ isPrimary: -1, joinedAt: -1 })
    .lean();
}
