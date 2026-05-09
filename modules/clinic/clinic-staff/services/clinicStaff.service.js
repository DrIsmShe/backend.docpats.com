// modules/clinic/clinic-staff/services/staff.service.js
//
// Business logic for managing clinic staff (memberships).
// All operations are tenant-scoped: they operate within current clinicId.

import mongoose from "mongoose";
import ClinicMembership from "../models/clinicMembership.model.js";
import { eventBus, EVENTS } from "../../../../common/events/eventBus.js";
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
  UnprocessableError,
} from "../../../../common/utils/errors.js";
import { canAssignRole } from "../../../../common/auth/roleHierarchy.js";
import { getCurrentClinicId } from "../../../../common/context/tenantContext.js";
import { ROLES } from "../../../../common/auth/permissions.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-staff/service" });

/**
 * List all active staff members for the current clinic.
 * Tenant-scoped via plugin: only current clinic's members visible.
 *
 * @param {object} options
 * @param {boolean} [options.includeLeft]  Include former staff (leftAt != null)
 * @returns {Promise<Array>}
 */
export async function listStaff(options = {}) {
  const filter = options.includeLeft ? {} : { leftAt: null };
  return ClinicMembership.find(filter)
    .sort({ isPrimary: -1, joinedAt: -1 })
    .lean();
}

/**
 * Add an existing user to current clinic with a role.
 *
 * @param {object} data
 * @param {string} data.userId   — existing User._id
 * @param {string} data.role     — role to assign
 * @param {string} [data.customTitle]
 * @param {string} [data.employmentType]
 * @param {object} actor         — { role: string } of the user performing this action
 * @param {string|ObjectId} actor.userId — for invitedBy
 * @returns {Promise<ClinicMembership>}
 */
export async function addStaff(data, actor) {
  if (!actor || !actor.role) {
    throw new ForbiddenError("Actor role required");
  }

  // Privilege escalation guard
  if (!canAssignRole(actor.role, data.role)) {
    throw new ForbiddenError(
      `Role '${actor.role}' cannot assign role '${data.role}'`,
      { actorRole: actor.role, targetRole: data.role },
    );
  }

  const clinicId = getCurrentClinicId();
  if (!clinicId) {
    throw new ForbiddenError("No active clinic context");
  }

  // Check for existing active membership
  const existing = await ClinicMembership.findOne({
    userId: data.userId,
    leftAt: null,
  });
  if (existing) {
    throw new ConflictError(
      "User already has an active membership in this clinic",
      {
        membershipId: String(existing._id),
      },
    );
  }

  const membership = await ClinicMembership.create({
    userId: data.userId,
    clinicId,
    role: data.role,
    customTitle: data.customTitle,
    employmentType: data.employmentType,
    invitedBy: actor.userId,
    joinedAt: new Date(),
    isActive: true,
  });

  log.info(
    {
      membershipId: String(membership._id),
      userId: String(data.userId),
      role: data.role,
      addedBy: String(actor.userId),
    },
    "Staff member added",
  );

  eventBus.emitSafe(EVENTS.STAFF_JOINED, {
    membershipId: String(membership._id),
    userId: String(data.userId),
    clinicId: String(clinicId),
    role: data.role,
  });

  return membership;
}

/**
 * Get a staff member by membership id (tenant-scoped).
 */
export async function getStaffById(membershipId) {
  const m = await ClinicMembership.findById(membershipId);
  if (!m) throw new NotFoundError("Staff member");
  return m;
}

/**
 * Change role of a staff member.
 *
 * Guards:
 *   - Actor must be senior to BOTH old role AND new role
 *   - Cannot demote the last owner
 *
 * @param {string} membershipId
 * @param {string} newRole
 * @param {object} actor — { userId, role }
 */
export async function updateStaffRole(membershipId, newRole, actor) {
  if (!actor || !actor.role) {
    throw new ForbiddenError("Actor role required");
  }

  const membership = await ClinicMembership.findById(membershipId);
  if (!membership) throw new NotFoundError("Staff member");

  // Actor must be senior to both old AND new role
  if (!canAssignRole(actor.role, membership.role)) {
    throw new ForbiddenError(
      `Role '${actor.role}' cannot modify members with role '${membership.role}'`,
    );
  }
  if (!canAssignRole(actor.role, newRole)) {
    throw new ForbiddenError(
      `Role '${actor.role}' cannot assign role '${newRole}'`,
    );
  }

  // Last owner protection
  if (membership.role === ROLES.OWNER && newRole !== ROLES.OWNER) {
    const ownerCount = await ClinicMembership.countDocuments({
      role: ROLES.OWNER,
      leftAt: null,
    });
    if (ownerCount <= 1) {
      throw new UnprocessableError(
        "Cannot demote the last owner of the clinic",
      );
    }
  }

  const oldRole = membership.role;
  membership.role = newRole;
  await membership.save();

  log.info(
    {
      membershipId: String(membershipId),
      oldRole,
      newRole,
      changedBy: String(actor.userId),
    },
    "Staff role changed",
  );

  eventBus.emitSafe(EVENTS.STAFF_ROLE_CHANGED, {
    membershipId: String(membershipId),
    userId: String(membership.userId),
    clinicId: String(membership.clinicId),
    oldRole,
    newRole,
  });

  return membership;
}

/**
 * Remove staff (soft delete = set leftAt).
 *
 * Guards:
 *   - Actor must be senior to target's role
 *   - Cannot remove yourself via this endpoint (use a separate "leave" flow)
 *   - Cannot remove the last owner
 *
 * @param {string} membershipId
 * @param {object} actor — { userId, role }
 */
export async function removeStaff(membershipId, actor) {
  if (!actor || !actor.role) {
    throw new ForbiddenError("Actor role required");
  }

  const membership = await ClinicMembership.findById(membershipId);
  if (!membership) throw new NotFoundError("Staff member");

  // Self-removal guard
  if (String(membership.userId) === String(actor.userId)) {
    throw new UnprocessableError(
      "Cannot remove yourself via staff endpoint. Contact another admin.",
    );
  }

  // Privilege guard
  if (!canAssignRole(actor.role, membership.role)) {
    throw new ForbiddenError(
      `Role '${actor.role}' cannot remove members with role '${membership.role}'`,
    );
  }

  // Last owner protection
  if (membership.role === ROLES.OWNER) {
    const ownerCount = await ClinicMembership.countDocuments({
      role: ROLES.OWNER,
      leftAt: null,
    });
    if (ownerCount <= 1) {
      throw new UnprocessableError(
        "Cannot remove the last owner of the clinic",
      );
    }
  }

  membership.leftAt = new Date();
  membership.isActive = false;
  await membership.save();

  log.info(
    {
      membershipId: String(membershipId),
      userId: String(membership.userId),
      removedBy: String(actor.userId),
    },
    "Staff member removed (soft)",
  );

  eventBus.emitSafe(EVENTS.STAFF_LEFT, {
    membershipId: String(membershipId),
    userId: String(membership.userId),
    clinicId: String(membership.clinicId),
  });

  return membership;
}
