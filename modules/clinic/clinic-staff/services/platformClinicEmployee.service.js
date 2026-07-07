// modules/clinic/clinic-staff/services/platformClinicEmployee.service.js
//
// PLATFORM-OWNER operations on the global ClinicEmployee identity.
//
// A clinic can only end its own membership (fire); it can NEVER delete the
// worker identity. Deleting the identity itself is a platform-owner action
// (User.role === "admin", enforced by requireAdmin on the route).
//
// Deletion is SOFT (isPlatformDeleted): the record stays for history/audit,
// but the worker can no longer log in and is removed from every clinic.

import mongoose from "mongoose";

import ClinicEmployee from "../models/clinicEmployee.model.js";
import ClinicMembership from "../models/clinicMembership.model.js";
import StaffInvitation from "../models/staffInvitation.model.js";

import {
  NotFoundError,
  ConflictError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-staff/platform-employee" });

/**
 * Soft-delete a global ClinicEmployee identity (platform owner only).
 *
 * Effects:
 *   1. isPlatformDeleted = true (+ platformDeletedAt/By) — blocks login.
 *   2. All ACTIVE memberships ended (leftAt = now, isActive = false) —
 *      the worker is removed from every clinic.
 *   3. All PENDING staff invitations for this identity's email revoked.
 *
 * @param {string} employeeId
 * @param {string} actorUserId — platform owner's User._id (from requireAdmin)
 * @returns {Promise<{employeeId, endedMemberships, revokedInvitations}>}
 */
export async function platformDeleteEmployee(employeeId, actorUserId) {
  if (!mongoose.isValidObjectId(employeeId)) {
    throw new NotFoundError("Worker identity not found");
  }

  const employee = await ClinicEmployee.findById(employeeId);
  if (!employee) {
    throw new NotFoundError("Worker identity not found");
  }
  if (employee.isPlatformDeleted) {
    throw new ConflictError("Worker identity is already deleted");
  }

  // 1. Soft-delete the identity.
  employee.isPlatformDeleted = true;
  employee.platformDeletedAt = new Date();
  employee.platformDeletedBy = actorUserId || null;
  employee.isActive = false;
  await employee.save();

  // 2. End every active membership (remove from all clinics).
  const membershipResult = await ClinicMembership.updateMany(
    {
      userId: employee._id,
      actorType: "employee",
      leftAt: null,
    },
    { $set: { leftAt: new Date(), isActive: false } },
  );

  // 3. Revoke all pending invitations addressed to this identity's email.
  const invitationResult = await StaffInvitation.updateMany(
    { emailHash: employee.emailHash, status: "pending" },
    {
      $set: {
        status: "revoked",
        revokedAt: new Date(),
        revokedBy: actorUserId || null,
      },
    },
  );

  const endedMemberships =
    membershipResult.modifiedCount ?? membershipResult.nModified ?? 0;
  const revokedInvitations =
    invitationResult.modifiedCount ?? invitationResult.nModified ?? 0;

  log.info(
    {
      employeeId: String(employee._id),
      deletedBy: String(actorUserId),
      endedMemberships,
      revokedInvitations,
    },
    "Platform owner soft-deleted a global clinic-worker identity",
  );

  return {
    employeeId: String(employee._id),
    endedMemberships,
    revokedInvitations,
  };
}
