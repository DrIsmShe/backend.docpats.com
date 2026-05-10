// modules/clinic/clinic-staff/services/employeeAuth.service.js
//
// Business logic for ClinicEmployee login and profile retrieval.
//
// Functions:
// - loginEmployee: verify email + password, return employee + clinic
// - getEmployeeWithClinic: load employee + clinic profile by id

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

/**
 * Verify email + password and return employee + clinic context.
 * Uses a constant-time-ish flow: argon2.verify is always called even when
 * the user does not exist (with a dummy hash) to reduce timing leakage.
 *
 * @param {object} args
 * @param {string} args.email
 * @param {string} args.password
 * @returns {Promise<{employee, clinic, membership}>}
 */
export async function loginEmployee({ email, password }) {
  const normalized = normalizeEmail(email);
  const emailHash = sha256(normalized);

  // Look up across all clinics (employee belongs to exactly one)
  const employee = await ClinicEmployee.findOne({
    emailHash,
    isDeleted: false,
  });

  // Constant-time-ish: always run argon2.verify so timing doesn't leak
  // whether the email exists. Use a known-bad hash if no employee found.
  const passwordHashToCheck =
    employee?.passwordHash ||
    "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

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

  // Find membership (must exist — created at invitation accept)
  const membership = await ClinicMembership.findOne({
    userId: employee._id,
    clinicId: employee.clinicId,
    actorType: "employee",
    isActive: true,
    leftAt: null,
  }).lean();

  if (!membership) {
    log.error(
      {
        employeeId: String(employee._id),
        clinicId: String(employee.clinicId),
      },
      "Employee has no active membership — login rejected",
    );
    throw new UnauthorizedError("Account is not active");
  }

  const clinic = await Clinic.findById(employee.clinicId).lean();
  if (!clinic) {
    log.error(
      { clinicId: String(employee.clinicId) },
      "Employee's clinic not found",
    );
    throw new UnauthorizedError("Account is not active");
  }

  log.info(
    {
      employeeId: String(employee._id),
      clinicId: String(clinic._id),
      role: membership.role,
    },
    "Employee logged in",
  );

  return { employee, clinic, membership };
}

/**
 * Load employee + their clinic for the /me endpoint.
 *
 * @param {string} employeeId
 * @returns {Promise<{employee, clinic, membership}>}
 */
export async function getEmployeeWithClinic(employeeId) {
  if (!mongoose.isValidObjectId(employeeId)) {
    throw new NotFoundError("Employee not found");
  }

  const employee = await ClinicEmployee.findById(employeeId);
  if (!employee || employee.isDeleted) {
    throw new NotFoundError("Employee not found");
  }

  const membership = await ClinicMembership.findOne({
    userId: employee._id,
    clinicId: employee.clinicId,
    actorType: "employee",
    isActive: true,
    leftAt: null,
  }).lean();

  if (!membership) {
    throw new NotFoundError("Employee has no active membership");
  }

  const clinic = await Clinic.findById(employee.clinicId).lean();
  if (!clinic) {
    throw new NotFoundError("Clinic not found");
  }

  return { employee, clinic, membership };
}

/**
 * Build a public-safe DTO for the employee.
 * Excludes passwordHash, encrypted-only fields, and internals.
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
    clinicId: String(employee.clinicId),
    email: decrypted.email,
    firstName: decrypted.firstName,
    lastName: decrypted.lastName,
    phoneNumber: decrypted.phoneNumber,
    role: employee.role,
    customTitle: employee.customTitle || null,
    preferredLanguage: employee.preferredLanguage,
    joinedAt: employee.joinedAt,
    isActive: employee.isActive,
  };
}
