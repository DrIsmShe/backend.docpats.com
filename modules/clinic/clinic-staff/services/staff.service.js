// modules/clinic/clinic-staff/services/staff.service.js

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

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) {
    throw new ForbiddenError("No active clinic context");
  }
  return clinicId;
}

export async function listStaff(options = {}) {
  const clinicId = requireClinicId();
  const filter = { clinicId };
  if (!options.includeLeft) {
    filter.leftAt = null;
  }
  return ClinicMembership.find(filter)
    .sort({ isPrimary: -1, joinedAt: -1 })
    .lean();
}

export async function addStaff(data, actor) {
  if (!actor || !actor.role) {
    throw new ForbiddenError("Actor role required");
  }

  if (!canAssignRole(actor.role, data.role)) {
    throw new ForbiddenError(
      `Role '${actor.role}' cannot assign role '${data.role}'`,
      { actorRole: actor.role, targetRole: data.role },
    );
  }

  const clinicId = requireClinicId();

  // Tenant-scoped check: only look in current clinic
  const existing = await ClinicMembership.findOne({
    userId: data.userId,
    clinicId,
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

export async function getStaffById(membershipId) {
  const clinicId = requireClinicId();
  const m = await ClinicMembership.findOne({ _id: membershipId, clinicId });
  if (!m) throw new NotFoundError("Staff member");
  return m;
}

export async function updateStaffRole(membershipId, newRole, actor) {
  if (!actor || !actor.role) {
    throw new ForbiddenError("Actor role required");
  }

  const clinicId = requireClinicId();
  const membership = await ClinicMembership.findOne({
    _id: membershipId,
    clinicId,
  });
  if (!membership) throw new NotFoundError("Staff member");

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

  if (membership.role === ROLES.OWNER && newRole !== ROLES.OWNER) {
    const ownerCount = await ClinicMembership.countDocuments({
      clinicId,
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

export async function removeStaff(membershipId, actor) {
  if (!actor || !actor.role) {
    throw new ForbiddenError("Actor role required");
  }

  const clinicId = requireClinicId();
  const membership = await ClinicMembership.findOne({
    _id: membershipId,
    clinicId,
  });
  if (!membership) throw new NotFoundError("Staff member");

  if (String(membership.userId) === String(actor.userId)) {
    throw new UnprocessableError(
      "Cannot remove yourself via staff endpoint. Contact another admin.",
    );
  }

  if (!canAssignRole(actor.role, membership.role)) {
    throw new ForbiddenError(
      `Role '${actor.role}' cannot remove members with role '${membership.role}'`,
    );
  }

  if (membership.role === ROLES.OWNER) {
    const ownerCount = await ClinicMembership.countDocuments({
      clinicId,
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
