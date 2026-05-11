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

// ─── listStaff ──────────────────────────────────────────────────────────
//
// Returns memberships of the current clinic with the actor's decrypted PII
// merged in. The actor lives in one of two collections depending on
// `membership.actorType`:
//
//   - "user"     → User collection      (DocPats doctor — owner/admin/doctor)
//   - "employee" → ClinicEmployee       (internal staff: nurse, receptionist…)
//
// We do two bulk fetches in parallel (User + ClinicEmployee), then decrypt
// PII using each model's existing helper (no inline crypto).

export async function listStaff(options = {}) {
  const clinicId = requireClinicId();
  const filter = { clinicId };
  if (!options.includeLeft) {
    filter.leftAt = null;
  }

  // 1. Load memberships
  const memberships = await ClinicMembership.find(filter)
    .sort({ isPrimary: -1, joinedAt: -1 })
    .lean();

  if (memberships.length === 0) return [];

  // 2. Split userIds by actorType — they point to different collections
  const userIds = [];
  const employeeIds = [];
  for (const m of memberships) {
    if (m.actorType === "employee") {
      employeeIds.push(m.userId);
    } else {
      userIds.push(m.userId);
    }
  }

  // 3. Bulk fetch from both collections in parallel
  const User = (await import("../../../../common/models/Auth/users.js"))
    .default;
  const ClinicEmployee = (await import("../models/clinicEmployee.model.js"))
    .default;

  const [users, employees] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select(
            "_id username avatar emailEncrypted firstNameEncrypted lastNameEncrypted role isDoctor",
          )
          .lean()
      : Promise.resolve([]),
    employeeIds.length
      ? ClinicEmployee.find({ _id: { $in: employeeIds } })
          .select(
            "_id avatar customTitle emailEncrypted firstNameEncrypted lastNameEncrypted phoneNumberEncrypted preferredLanguage isActive",
          )
          .lean()
      : Promise.resolve([]),
  ]);

  // 4. Build lookup maps keyed by stringified _id (O(1) lookup)
  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const employeeMap = new Map(employees.map((e) => [String(e._id), e]));

  // 5. Import decrypt helpers from each model — single source of truth
  const { decrypt: decryptUser } =
    await import("../../../../common/models/Auth/users.js");
  const { decryptValue: decryptEmployee } =
    await import("../models/clinicEmployee.model.js");

  const safeDecrypt = (fn, value) => {
    if (!value) return null;
    try {
      const result = fn(value);
      return result || null;
    } catch (err) {
      log.warn({ err: err.message }, "Failed to decrypt staff PII field");
      return null;
    }
  };

  // 6. Merge: enrich each membership with decrypted PII from its source
  const enriched = memberships.map((m) => {
    const idStr = String(m.userId);

    if (m.actorType === "employee") {
      const emp = employeeMap.get(idStr);
      if (!emp) {
        return { ...m, firstName: null, lastName: null, email: null };
      }
      return {
        ...m,
        firstName: safeDecrypt(decryptEmployee, emp.firstNameEncrypted),
        lastName: safeDecrypt(decryptEmployee, emp.lastNameEncrypted),
        email: safeDecrypt(decryptEmployee, emp.emailEncrypted),
        phoneNumber: safeDecrypt(decryptEmployee, emp.phoneNumberEncrypted),
        avatar: emp.avatar || null,
        username: null,
        actorIsActive: emp.isActive !== false,
        sourceCustomTitle: emp.customTitle || null,
      };
    }

    // actorType === "user" (default for DocPats doctors)
    const user = userMap.get(idStr);
    if (!user) {
      log.warn(
        { userId: idStr, actorType: m.actorType },
        "User not found for staff membership",
      );
      return { ...m, firstName: null, lastName: null, email: null };
    }
    return {
      ...m,
      firstName: safeDecrypt(decryptUser, user.firstNameEncrypted),
      lastName: safeDecrypt(decryptUser, user.lastNameEncrypted),
      email: safeDecrypt(decryptUser, user.emailEncrypted),
      avatar: user.avatar || null,
      username: user.username || null,
      actorIsActive: true,
    };
  });

  return enriched;
}

// ─── addStaff ───────────────────────────────────────────────────────────

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
      { membershipId: String(existing._id) },
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

// ─── getStaffById ───────────────────────────────────────────────────────

export async function getStaffById(membershipId) {
  const clinicId = requireClinicId();
  const m = await ClinicMembership.findOne({ _id: membershipId, clinicId });
  if (!m) throw new NotFoundError("Staff member");
  return m;
}

// ─── updateStaffRole ────────────────────────────────────────────────────

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

  // Owner safeguard: can't demote the last owner
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

// ─── removeStaff ────────────────────────────────────────────────────────

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
    membershipId: String(membership._id),
    userId: String(membership.userId),
    clinicId: String(membership.clinicId),
  });

  return membership;
}
