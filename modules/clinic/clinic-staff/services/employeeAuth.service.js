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
import { recordActionAsync } from "../../../audit/index.js";

const log = logger.child({ module: "clinic-staff/employee-auth" });

const sha256 = (v) =>
  crypto.createHash("sha256").update(String(v)).digest("hex");

const normalizeEmail = (v) => String(v).trim().toLowerCase();

// Known-bad argon2 hash — verified against when no identity is found, so login
// timing doesn't leak whether the email exists.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// Блокировка конкретной учётной записи после серии неудачных попыток.
// Ограничитель по IP живёт в роутере (loginLimiter) — он про другое: не даёт
// перебирать МНОГО аккаунтов с одного адреса. А эта блокировка не даёт долбить
// ОДИН аккаунт с разных адресов.
// Успешное восстановление пароля снимает блокировку (см. employeePassword.service.js),
// поэтому запертый сотрудник никогда не остаётся без выхода.
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/** Актор для аудита. Расшифрованных ПДн здесь быть не должно. */
function auditActor(employee) {
  return { userId: String(employee._id), role: "employee" };
}

/** Записать исход входа в HIPAA-журнал (hipaa_audit_logs). */
function recordLoginOutcome(
  employee,
  { outcome, failureReason, context, metadata },
) {
  recordActionAsync({
    actor: auditActor(employee),
    action: outcome === "success" ? "auth.login" : "auth.failed_login",
    resourceType: "clinic-employee",
    resourceId: employee._id,
    resourceOwnerId: employee._id,
    outcome,
    failureReason,
    context,
    metadata,
  });
}

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
 * Неверные пароли копятся в failedLoginAttempts; на MAX_FAILED_LOGIN_ATTEMPTS
 * учётка запирается на LOCKOUT_MINUTES. Счётчик обнуляется при успешном входе,
 * а восстановление пароля снимает блокировку целиком.
 *
 * @param {object} args
 * @param {string} args.email
 * @param {string} args.password
 * @param {object} [args.context] — { ipAddress, userAgent, sessionId } для аудита
 * @returns {Promise<{employee, memberships}>}
 */
export async function loginEmployee({ email, password, context = {} }) {
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

  // Заперт — отказываем даже при верном пароле, иначе блокировка декоративная.
  // Проверяем ПОСЛЕ argon2, чтобы не менять временной профиль ответа.
  if (
    employee?.lockoutUntil &&
    new Date(employee.lockoutUntil).getTime() > Date.now()
  ) {
    log.warn(
      { employeeId: String(employee._id) },
      "Locked-out employee attempted login",
    );
    recordLoginOutcome(employee, {
      outcome: "denied",
      failureReason: "Account is temporarily locked",
      context,
    });
    throw new UnauthorizedError(
      "Account is temporarily locked. Try again later or reset your password.",
    );
  }

  if (!employee || !isValid) {
    if (employee) {
      employee.failedLoginAttempts = (employee.failedLoginAttempts || 0) + 1;

      const locked = employee.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
      if (locked) {
        employee.lockoutUntil = new Date(
          Date.now() + LOCKOUT_MINUTES * 60 * 1000,
        );
        employee.failedLoginAttempts = 0;
      }
      await employee.save();

      if (locked) {
        log.warn(
          { employeeId: String(employee._id) },
          "Employee account locked after repeated failed logins",
        );
        recordActionAsync({
          actor: auditActor(employee),
          action: "auth.account_locked",
          resourceType: "clinic-employee",
          resourceId: employee._id,
          resourceOwnerId: employee._id,
          outcome: "success",
          context,
          metadata: { lockoutMinutes: LOCKOUT_MINUTES },
        });
      }

      recordLoginOutcome(employee, {
        outcome: "failure",
        failureReason: "Invalid password",
        context,
        metadata: { locked },
      });
    }

    // Неизвестный email — аудит писать не на кого (нет актора), только pino.
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
    recordLoginOutcome(employee, {
      outcome: "denied",
      failureReason: "Account is not active",
      context,
    });
    throw new UnauthorizedError("Account is not active");
  }

  if (employee.isBlocked === true) {
    log.warn(
      { employeeId: String(employee._id) },
      "Blocked employee attempted login",
    );
    recordLoginOutcome(employee, {
      outcome: "denied",
      failureReason: "Account is blocked",
      context,
    });
    throw new UnauthorizedError("Account is blocked");
  }

  // Which clinics can this worker enter right now?
  const memberships = await listEmployeeMemberships(employee._id);
  if (!memberships.length) {
    log.warn(
      { employeeId: String(employee._id) },
      "Employee has no active clinic membership — login rejected",
    );
    recordLoginOutcome(employee, {
      outcome: "denied",
      failureReason: "No active clinic membership",
      context,
    });
    throw new UnauthorizedError("You are not a member of any active clinic");
  }

  // Успешный вход обнуляет серию неудач и проставляет lastLoginAt
  // (поле в модели было, но его никто никогда не писал).
  employee.failedLoginAttempts = 0;
  employee.lockoutUntil = null;
  employee.lastLoginAt = new Date();
  await employee.save();

  log.info(
    { employeeId: String(employee._id), clinics: memberships.length },
    "Employee logged in",
  );

  recordLoginOutcome(employee, {
    outcome: "success",
    context,
    metadata: { clinics: memberships.length },
  });

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
    // Чтобы клиент мог увести сотрудника на принудительную смену пароля.
    mustChangePassword: employee.mustChangePassword === true,
    lastPasswordChangeAt: employee.lastPasswordChangeAt || null,
  };
}
