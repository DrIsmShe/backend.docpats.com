// modules/clinic/clinic-staff/services/employeeAuth.service.js
//
// Business logic for ClinicEmployee login and profile retrieval
// (Global Clinic Worker model).
//
// A ClinicEmployee is ONE global identity (unique emailHash). It may be a
// member of several clinics at once via ClinicMembership. Login authenticates
// the identity, then returns the list of clinics the worker is currently
// active in; the caller (controller) either auto-selects the single clinic or
// asks the worker to pick one. The selected clinicId lives in the session.
//
// Functions:
// - loginEmployee: verify email + password, return identity + active clinics
// - listEmployeeMemberships: active clinic memberships for an identity
// - getEmployeeWithClinic: load identity + one selected clinic's membership
// - employeeToDTO: public-safe identity DTO (no clinic/role — those are per-clinic)

import crypto from "crypto";
import argon2 from "argon2";
import mongoose from "mongoose";

import ClinicEmployee from "../models/clinicEmployee.model.js";
import ClinicMembership from "../models/clinicMembership.model.js";
import Clinic from "../../clinic-core/models/clinic.model.js";

import {
  UnauthorizedError,
  NotFoundError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-staff/employee-auth" });

const sha256 = (v) =>
  crypto.createHash("sha256").update(String(v)).digest("hex");

const normalizeEmail = (v) => String(v).trim().toLowerCase();

// Known-bad argon2 hash — verified against when no identity is found, so login
// timing doesn't leak whether the email exists.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/**
 * Load the worker's ACTIVE clinic memberships (leftAt: null), each enriched
 * with a small clinic summary. Used both by login (which clinics can I enter?)
 * and by the clinic-selection screen.
 *
 * @param {mongoose.Types.ObjectId|string} employeeId
 * @returns {Promise<Array<{membershipId, clinicId, role, permissions, clinic}>>}
 */
export async function listEmployeeMemberships(employeeId) {
  const memberships = await ClinicMembership.find({
    userId: employeeId,
    actorType: "employee",
    isActive: true,
    leftAt: null,
  }).lean();

  if (!memberships.length) return [];

  const clinicIds = memberships.map((m) => m.clinicId);
  const clinics = await Clinic.find({ _id: { $in: clinicIds } })
    .select("name slug tier")
    .lean();
  const clinicMap = new Map(clinics.map((c) => [String(c._id), c]));

  return memberships
    .map((m) => {
      const c = clinicMap.get(String(m.clinicId));
      if (!c) return null; // clinic deleted — skip
      return {
        membershipId: String(m._id),
        clinicId: String(m.clinicId),
        role: m.role,
        permissions: m.permissions || {},
        clinic: {
          _id: String(c._id),
          name: c.name,
          slug: c.slug,
          tier: c.tier,
        },
      };
    })
    .filter(Boolean);
}

/**
 * Verify email + password and return the identity plus the clinics it can
 * enter. Constant-time-ish: argon2.verify always runs (dummy hash when the
 * identity is not found) to reduce timing leakage.
 *
 * @param {object} args
 * @param {string} args.email
 * @param {string} args.password
 * @returns {Promise<{employee, memberships}>}
 */
export async function loginEmployee({ email, password }) {
  const normalized = normalizeEmail(email);
  const emailHash = sha256(normalized);

  // Global identity lookup (not scoped to a clinic anymore).
  const employee = await ClinicEmployee.findOne({
    emailHash,
    isPlatformDeleted: false,
  });

  const passwordHashToCheck = employee?.passwordHash || DUMMY_HASH;

  let isValid = false;
  try {
    isValid = await argon2.verify(passwordHashToCheck, password);
  } catch {
    isValid = false;
  }

  if (!employee || !isValid) {
    log.warn(
      { emailHash, found: Boolean(employee) },
      "Failed employee login attempt",
    );
    throw new UnauthorizedError("Invalid email or password");
  }

  if (employee.isActive === false) {
    log.warn(
      { employeeId: String(employee._id) },
      "Inactive employee attempted login",
    );
    throw new UnauthorizedError("Account is not active");
  }

  if (employee.isBlocked === true) {
    log.warn(
      { employeeId: String(employee._id) },
      "Blocked employee attempted login",
    );
    throw new UnauthorizedError("Account is blocked");
  }

  // Which clinics can this worker enter right now?
  const memberships = await listEmployeeMemberships(employee._id);
  if (!memberships.length) {
    log.warn(
      { employeeId: String(employee._id) },
      "Employee has no active clinic membership — login rejected",
    );
    throw new UnauthorizedError("You are not a member of any active clinic");
  }

  log.info(
    { employeeId: String(employee._id), clinics: memberships.length },
    "Employee logged in",
  );

  return { employee, memberships };
}

/**
 * Load identity + the SELECTED clinic's membership for the /me endpoint.
 * The selected clinicId comes from the session (set at login when there is a
 * single clinic, or via the clinic-selection step when there are several).
 *
 * @param {string} employeeId
 * @param {string} clinicId
 * @returns {Promise<{employee, clinic, membership}>}
 */
export async function getEmployeeWithClinic(employeeId, clinicId) {
  if (!mongoose.isValidObjectId(employeeId)) {
    throw new NotFoundError("Employee not found");
  }

  const employee = await ClinicEmployee.findById(employeeId);
  if (!employee || employee.isPlatformDeleted) {
    throw new NotFoundError("Employee not found");
  }

  if (!clinicId || !mongoose.isValidObjectId(clinicId)) {
    // No clinic chosen yet — caller should route to clinic selection.
    throw new UnauthorizedError("No clinic selected");
  }

  const membership = await ClinicMembership.findOne({
    userId: employee._id,
    clinicId,
    actorType: "employee",
    isActive: true,
    leftAt: null,
  }).lean();

  if (!membership) {
    throw new UnauthorizedError("No active membership in this clinic");
  }

  const clinic = await Clinic.findById(clinicId).lean();
  if (!clinic) {
    throw new NotFoundError("Clinic not found");
  }

  return { employee, clinic, membership };
}

/**
 * Build a public-safe DTO for the identity.
 * NOTE: no clinicId/role here — those are per-clinic and returned separately
 * by the controller from the selected membership.
 */
export function employeeToDTO(employee) {
  const decrypted = employee.decryptFields
    ? employee.decryptFields()
    : {
        firstName: null,
        lastName: null,
        email: null,
        phoneNumber: null,
      };

  return {
    _id: String(employee._id),
    email: decrypted.email,
    firstName: decrypted.firstName,
    lastName: decrypted.lastName,
    phoneNumber: decrypted.phoneNumber,
    customTitle: employee.customTitle || null,
    preferredLanguage: employee.preferredLanguage,
    joinedAt: employee.joinedAt,
    isActive: employee.isActive,
  };
}
