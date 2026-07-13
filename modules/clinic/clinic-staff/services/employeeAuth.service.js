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
// - toClinicContextDTO: shared clinic DTO (core + витрина/site_builder fields)

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

// ───────────────────────────────────────────────────────────────────────────
// Витринные / site_builder поля клиники, которые employee-контекст должен
// нести, чтобы редактор витрины (ClinicPublicPageSettings) в employee-режиме
// имел данные для рендера/сохранения. НЕ PHI. Держать в синхроне с:
//   - clinic.model.js (имена полей)
//   - clinic.controller.js SITE_BUILDER_FIELDS (поля, которые marketer правит)
// Порядок select-строки не важен; _id включается автоматически.
// ───────────────────────────────────────────────────────────────────────────
const CLINIC_CONTEXT_SELECT = [
  "name",
  "slug",
  "tier",
  "logo",
  "description",
  "gallery",
  "coverImage",
  "pageBackground",
  "slogan",
  "callCenterPhone",
  "callCenterHours",
  "faq",
  "isPublished",
  "theme",
  "layout",
  "contacts",
  "address",
].join(" ");

/**
 * Единый DTO клиники для employee-контекста (login / me / select-clinic).
 * Форма ДОЛЖНА быть одинаковой во всех трёх путях — иначе поведение витрины
 * различается «сразу после входа» vs «после reload». Принимает как полный
 * Mongoose-док (getEmployeeWithClinic → .lean()), так и уже выбранный select.
 *
 * @param {object} c — clinic doc/lean (может быть частичным по select)
 * @returns {object|null}
 */
export function toClinicContextDTO(c) {
  if (!c) return null;
  return {
    _id: String(c._id),
    name: c.name,
    slug: c.slug,
    tier: c.tier,
    // витрина / site_builder
    logo: c.logo ?? null,
    description: c.description ?? "",
    gallery: Array.isArray(c.gallery)
      ? c.gallery.map((g) => ({
          id: String(g._id),
          url: g.url,
          caption: g.caption || "",
          order: g.order ?? 0,
        }))
      : [],
    coverImage: c.coverImage ?? null,
    pageBackground: c.pageBackground ?? null,
    slogan: c.slogan ?? "",
    callCenterPhone: c.callCenterPhone ?? "",
    callCenterHours: c.callCenterHours ?? "",
    faq: Array.isArray(c.faq)
      ? c.faq.map((f) => ({ q: f.q || "", a: f.a || "" }))
      : [],
    isPublished: c.isPublished === true,
    theme: c.theme || {},
    layout: c.layout || {},
    contacts: c.contacts || {},
    address: c.address || {},
  };
}

/**
 * Load the worker's ACTIVE clinic memberships (leftAt: null), each enriched
 * with a clinic DTO (core + витрина). Used both by login (which clinics can I
 * enter?) and by the clinic-selection screen.
 *
 * NOTE: select is widened to CLINIC_CONTEXT_SELECT so the single-clinic
 * auto-select path (login) returns the SAME толстый clinic as /me — no
 * "works after reload only" asymmetry for the vitrina editor.
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
    .select(CLINIC_CONTEXT_SELECT)
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
        clinic: toClinicContextDTO(c),
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
 * Returns the FULL clinic doc (.lean()) — the controller passes it through
 * toClinicContextDTO for the same shape as the login path.
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
