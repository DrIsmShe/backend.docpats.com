// modules/clinic/clinic-staff/controllers/staff.controller.js

import * as service from "../services/staff.service.js";
import {
  addStaffSchema,
  updateRoleSchema,
} from "../validators/staff.schemas.js";
import {
  UnauthorizedError,
  ValidationError,
  ForbiddenError,
} from "../../../../common/utils/errors.js";
import {
  getCurrentUserId,
  getCurrentRole,
  getCurrentClinicId,
} from "../../../../common/context/tenantContext.js";
import { can } from "../../../../common/auth/can.js";

function requireActor() {
  const userId = getCurrentUserId();
  const role = getCurrentRole();
  const clinicId = getCurrentClinicId();
  if (!userId || !role || !clinicId) {
    throw new UnauthorizedError("Authentication and clinic context required");
  }
  return { userId, role, clinicId };
}

export async function listStaff(req, res, next) {
  try {
    requireActor();
    if (!can("staff", "read")) {
      throw new ForbiddenError("staff.read permission required");
    }
    const includeLeft = req.query.includeLeft === "true";
    const staff = await service.listStaff({ includeLeft });
    res.json({
      staff: staff.map((m) => ({
        membershipId: String(m._id),
        userId: String(m.userId),
        clinicId: String(m.clinicId),
        role: m.role,
        customTitle: m.customTitle,
        employmentType: m.employmentType,
        isPrimary: m.isPrimary,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function addStaff(req, res, next) {
  try {
    const actor = requireActor();
    if (!can("staff", "write")) {
      throw new ForbiddenError("staff.write permission required");
    }

    const parsed = addStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid staff data", {
        issues: parsed.error.issues,
      });
    }

    const membership = await service.addStaff(parsed.data, actor);

    res.status(201).json({
      membership: {
        membershipId: String(membership._id),
        userId: String(membership.userId),
        clinicId: String(membership.clinicId),
        role: membership.role,
        customTitle: membership.customTitle,
        joinedAt: membership.joinedAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function updateStaffRole(req, res, next) {
  try {
    const actor = requireActor();
    if (!can("staff", "write")) {
      throw new ForbiddenError("staff.write permission required");
    }

    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid role data", {
        issues: parsed.error.issues,
      });
    }

    const updated = await service.updateStaffRole(
      req.params.id,
      parsed.data.role,
      actor,
    );

    res.json({
      membership: {
        membershipId: String(updated._id),
        userId: String(updated.userId),
        role: updated.role,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function removeStaff(req, res, next) {
  try {
    const actor = requireActor();
    if (!can("staff", "delete")) {
      throw new ForbiddenError("staff.delete permission required");
    }

    const removed = await service.removeStaff(req.params.id, actor);

    res.json({
      membership: {
        membershipId: String(removed._id),
        userId: String(removed.userId),
        leftAt: removed.leftAt,
      },
    });
  } catch (err) {
    next(err);
  }
}
import * as searchService from "../services/searchDoctors.service.js";

export async function searchDoctors(req, res, next) {
  try {
    requireActor();
    if (!can("staff", "write")) {
      throw new ForbiddenError("staff.write permission required");
    }

    const query = req.query.q || "";
    const doctors = await searchService.searchDoctors(query);

    res.json({ doctors });
  } catch (err) {
    next(err);
  }
}
