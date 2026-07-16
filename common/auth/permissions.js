// server/common/auth/permissions.js
//
// Catalog of all RESOURCES and ACTIONS in the clinic system.
// Defines default ROLE_PERMISSIONS for each preset role.
//
// Usage:
//   import { RESOURCES, ACTIONS, ROLE_PERMISSIONS } from "./permissions.js";
//   const canRead = ROLE_PERMISSIONS["doctor"]?.[RESOURCES.PATIENT]?.[ACTIONS.READ];

/**
 * All resource types in the system.
 * When adding a new module — add a resource here and update ROLE_PERMISSIONS.
 */
export const RESOURCES = Object.freeze({
  // clinic core
  CLINIC: "clinic",
  STAFF: "staff",
  STAFF_INVITE: "staff_invite",

  // org structure
  DEPARTMENT: "department",
  ROOM: "room",
  EQUIPMENT: "equipment",
  KNOWLEDGE: "knowledge",
  CONSILIUM: "consilium",
  TELEMED: "telemed",
  SERVICE: "service", // прайс-лист услуг клиники
  ANNOUNCEMENT: "announcement", // внутренние объявления клиники

  // patients & medical records
  PATIENT: "patient",
  MEDICAL_RECORD: "medical_record",
  PRESCRIPTION: "prescription",

  // scheduling
  SCHEDULE: "schedule",
  APPOINTMENT: "appointment",

  // patient flow
  QUEUE: "queue",
  CHECKIN: "checkin",

  // billing & finance
  BILLING: "billing",
  PAYMENT: "payment",
  FINANCE_REPORT: "finance_report",
  ACCOUNTING: "accounting",
  PAYROLL: "payroll",

  // pharmacy & inventory
  PHARMACY: "pharmacy",
  INVENTORY: "inventory",
  SUPPLIER: "supplier",
  REQUISITION: "requisition", // NEW — заявки отделений в аптеку (nurse → pharmacist)

  // marketing & site
  REVIEW: "review",
  ARTICLE: "article",
  SITE_BUILDER: "site_builder",
  MARKETING: "marketing",
  LEAD: "lead",

  // analytics
  ANALYTICS: "analytics",
  ANALYTICS_FINANCE: "analytics_finance",

  // referrals
  REFERRAL: "referral",

  // reception
  RECEPTION: "reception",

  // settings
  SETTINGS: "settings",
  INTEGRATIONS: "integrations",
  WEBHOOKS: "webhooks",

  // audit
  AUDIT_LOG: "audit_log",
});

/**
 * All actions that can be performed on a resource.
 */
export const ACTIONS = Object.freeze({
  READ: "read",
  WRITE: "write",
  DELETE: "delete",
});

/**
 * All system roles (presets). Custom permissions can override these per-user.
 */
export const ROLES = Object.freeze({
  OWNER: "owner",
  ADMIN: "admin",
  MANAGER: "manager",
  DOCTOR: "doctor",
  NURSE: "nurse",
  RECEPTIONIST: "receptionist",
  ACCOUNTANT: "accountant",
  PHARMACIST: "pharmacist",
  MARKETER: "marketer",
});

// Permission shorthand
const FULL = Object.freeze({ read: true, write: true, delete: true });
const RW = Object.freeze({ read: true, write: true, delete: false });
const RO = Object.freeze({ read: true, write: false, delete: false });
const NONE = Object.freeze({ read: false, write: false, delete: false });

/**
 * Default permissions for each role.
 * These are the "starting point" — admin can override per-user via UI.
 *
 * Special role "owner" gets full permissions on EVERYTHING (computed below).
 *
 * ORG STRUCTURE (department, room):
 *   write — admin, manager (owner gets it via _ownerPermissions)
 *   read  — every clinical role that needs to pick a department/room
 *           (doctor, nurse, receptionist) + manager + admin
 *
 * REQUISITION (заявки отделений в аптеку):
 *   write — nurse (создаёт/правит заявку своего отделения),
 *           pharmacist (исполняет: partially_dispensed → dispensed / rejected)
 *   read  — manager, admin (надзор); owner через _ownerPermissions
 *   Скоуп по отделению (медсестра видит только свои заявки) — в сервисном
 *   слое, RBAC здесь грубый (ресурс × действие).
 */
const _basePermissions = {
  [ROLES.ADMIN]: {
    [RESOURCES.CLINIC]: RW,
    [RESOURCES.STAFF]: RO,
    [RESOURCES.STAFF_INVITE]: NONE,
    // admin (уровень 7) старше manager (6) и должен мочь править орг-структуру —
    // раньше было RO, что при включении RBAC мешало админу создавать
    // отделения/кабинеты/оборудование. Приведено к RW для согласованности.
    [RESOURCES.DEPARTMENT]: RW,
    [RESOURCES.ROOM]: RW,
    [RESOURCES.EQUIPMENT]: RW,
    [RESOURCES.KNOWLEDGE]: FULL,
    [RESOURCES.CONSILIUM]: FULL,
    [RESOURCES.TELEMED]: FULL,
    [RESOURCES.SERVICE]: FULL,
    [RESOURCES.ANNOUNCEMENT]: FULL,
    [RESOURCES.PATIENT]: FULL,
    [RESOURCES.MEDICAL_RECORD]: RW,
    [RESOURCES.PRESCRIPTION]: RO,
    [RESOURCES.SCHEDULE]: FULL,
    [RESOURCES.APPOINTMENT]: FULL,
    [RESOURCES.QUEUE]: FULL,
    [RESOURCES.CHECKIN]: FULL,
    [RESOURCES.BILLING]: FULL,
    [RESOURCES.PAYMENT]: RW,
    [RESOURCES.FINANCE_REPORT]: RO,
    [RESOURCES.ACCOUNTING]: NONE,
    [RESOURCES.PAYROLL]: NONE,
    [RESOURCES.PHARMACY]: RW,
    [RESOURCES.INVENTORY]: FULL,
    [RESOURCES.SUPPLIER]: FULL,
    [RESOURCES.REQUISITION]: RO, // NEW — надзор за заявками
    [RESOURCES.REVIEW]: FULL,
    [RESOURCES.ARTICLE]: FULL,
    [RESOURCES.SITE_BUILDER]: FULL,
    [RESOURCES.MARKETING]: FULL,
    [RESOURCES.LEAD]: FULL,
    [RESOURCES.ANALYTICS]: RO,
    [RESOURCES.ANALYTICS_FINANCE]: NONE,
    [RESOURCES.REFERRAL]: FULL,
    [RESOURCES.RECEPTION]: FULL,
    [RESOURCES.SETTINGS]: RW,
    [RESOURCES.INTEGRATIONS]: RW,
    [RESOURCES.WEBHOOKS]: RW,
    [RESOURCES.AUDIT_LOG]: RO,
  },

  [ROLES.MANAGER]: {
    [RESOURCES.STAFF]: RW,
    [RESOURCES.DEPARTMENT]: RW,
    [RESOURCES.ROOM]: RW,
    [RESOURCES.EQUIPMENT]: RW,
    [RESOURCES.KNOWLEDGE]: RW,
    [RESOURCES.CONSILIUM]: RW,
    [RESOURCES.TELEMED]: RW,
    [RESOURCES.SERVICE]: RW,
    [RESOURCES.ANNOUNCEMENT]: RW,
    [RESOURCES.PATIENT]: RO,
    [RESOURCES.SCHEDULE]: FULL,
    [RESOURCES.APPOINTMENT]: FULL,
    [RESOURCES.QUEUE]: FULL,
    [RESOURCES.CHECKIN]: FULL,
    [RESOURCES.BILLING]: RW,
    [RESOURCES.INVENTORY]: RW,
    [RESOURCES.PHARMACY]: RO,
    [RESOURCES.REQUISITION]: RO, // NEW — надзор за заявками
    [RESOURCES.REVIEW]: RW,
    [RESOURCES.LEAD]: RW,
    [RESOURCES.ANALYTICS]: RO,
    [RESOURCES.REFERRAL]: RW,
    [RESOURCES.RECEPTION]: FULL,
  },

  [ROLES.DOCTOR]: {
    [RESOURCES.DEPARTMENT]: RO,
    [RESOURCES.ROOM]: RO,
    [RESOURCES.EQUIPMENT]: RO,
    [RESOURCES.KNOWLEDGE]: RO,
    [RESOURCES.CONSILIUM]: RW,
    [RESOURCES.TELEMED]: RW,
    [RESOURCES.PATIENT]: RO,
    [RESOURCES.MEDICAL_RECORD]: RW,
    [RESOURCES.PRESCRIPTION]: RW,
    [RESOURCES.APPOINTMENT]: RW,
    [RESOURCES.SCHEDULE]: { read: true, write: true, delete: false },
    [RESOURCES.QUEUE]: RO,
    [RESOURCES.REFERRAL]: RW,
    [RESOURCES.ARTICLE]: RW,
  },

  [ROLES.NURSE]: {
    [RESOURCES.DEPARTMENT]: RO,
    [RESOURCES.ROOM]: RO,
    [RESOURCES.EQUIPMENT]: RO,
    [RESOURCES.KNOWLEDGE]: RO,
    [RESOURCES.CONSILIUM]: RO,
    [RESOURCES.TELEMED]: RO,
    [RESOURCES.PATIENT]: RO,
    [RESOURCES.MEDICAL_RECORD]: { read: true, write: true, delete: false },
    [RESOURCES.APPOINTMENT]: RO,
    [RESOURCES.QUEUE]: RW,
    [RESOURCES.CHECKIN]: RW,
    [RESOURCES.INVENTORY]: { read: true, write: true, delete: false },
    [RESOURCES.REQUISITION]: RW, // NEW — подаёт/правит заявку своего отделения
  },

  [ROLES.RECEPTIONIST]: {
    [RESOURCES.STAFF]: RO,
    [RESOURCES.DEPARTMENT]: RO,
    [RESOURCES.ROOM]: RO,
    [RESOURCES.EQUIPMENT]: RO,
    [RESOURCES.KNOWLEDGE]: RO,
    [RESOURCES.TELEMED]: RW,
    [RESOURCES.PATIENT]: RW,
    [RESOURCES.APPOINTMENT]: FULL,
    [RESOURCES.SCHEDULE]: RO,
    [RESOURCES.QUEUE]: FULL,
    [RESOURCES.CHECKIN]: FULL,
    [RESOURCES.BILLING]: { read: true, write: true, delete: false },
    [RESOURCES.PAYMENT]: RW,
    [RESOURCES.RECEPTION]: FULL,
    [RESOURCES.REFERRAL]: RO,
    [RESOURCES.LEAD]: RW,
  },

  [ROLES.ACCOUNTANT]: {
    [RESOURCES.BILLING]: RO,
    [RESOURCES.PAYMENT]: RO,
    [RESOURCES.FINANCE_REPORT]: FULL,
    [RESOURCES.ACCOUNTING]: FULL,
    [RESOURCES.PAYROLL]: FULL,
    [RESOURCES.ANALYTICS_FINANCE]: FULL,
    [RESOURCES.SUPPLIER]: RO,
  },

  [ROLES.PHARMACIST]: {
    [RESOURCES.PHARMACY]: FULL,
    [RESOURCES.INVENTORY]: { read: true, write: true, delete: false },
    [RESOURCES.PRESCRIPTION]: { read: true, write: true, delete: false },
    [RESOURCES.SUPPLIER]: RW,
    [RESOURCES.REQUISITION]: { read: true, write: true, delete: false }, // NEW — исполняет заявки
  },

  // MARKETER — публичный контур (витрина, свой маркет-контент, лиды, отзывы,
  // аналитика трафика). НЕ имеет доступа к контенту врача, PHI и финансам.
  // Всё, что не перечислено ниже, запрещено по умолчанию
  // (ROLE_PERMISSIONS[role]?.[resource]?.[action] === undefined → deny).
  [ROLES.MARKETER]: {
    // публичный сайт / витрина — ядро роли (создаёт и сносит свои страницы)
    [RESOURCES.SITE_BUILDER]: FULL,
    // собственный маркетинговый контент: свои статьи, кампании, лендинги
    [RESOURCES.MARKETING]: FULL,
    // лиды — чужие данные с атрибуцией: работать можно, жёстко удалять нельзя
    [RESOURCES.LEAD]: RW,
    // модерация отзывов: публиковать / скрывать / отвечать (write),
    // но НЕ удалять отзыв пациента и НЕ фабриковать (гейт в сервисе)
    [RESOURCES.REVIEW]: RW,
    // только просмотр аналитики трафика/просмотров сайта
    [RESOURCES.ANALYTICS]: RO,

    // --- явные запреты (для читаемости и защиты от будущих правок) ---
    // контент врача закрыт полностью
    [RESOURCES.ARTICLE]: NONE,
    // PHI — никогда
    [RESOURCES.PATIENT]: NONE,
    [RESOURCES.MEDICAL_RECORD]: NONE,
    [RESOURCES.PRESCRIPTION]: NONE,
    // финансовая аналитика закрыта
    [RESOURCES.ANALYTICS_FINANCE]: NONE,
  },
};

// Owner gets FULL access to ALL resources (computed)
const _ownerPermissions = Object.values(RESOURCES).reduce((acc, resource) => {
  acc[resource] = FULL;
  return acc;
}, {});

/**
 * Final ROLE_PERMISSIONS map.
 * Frozen to prevent runtime mutation.
 */
export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.OWNER]: Object.freeze(_ownerPermissions),
  ..._basePermissions,
});

/**
 * Helper: get default permissions for a role (or empty object if unknown).
 * @param {string} role
 * @returns {object}
 */
export function getDefaultPermissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || {};
}

/**
 * Compute the EFFECTIVE permission map for a role, merging per-user
 * overrides on top of the role's defaults.
 *
 * Resolution per resource (matches the inline logic previously used in
 * GET /clinic/me — extracted here as the single source of truth):
 *   1. override for that resource  (admin-set; wins as a whole object)
 *   2. role default for that resource
 *   3. { read: false, write: false, delete: false }
 *
 * The returned map covers the UNION of resources present in either source.
 * Send this to the client so the frontend never needs a copy of
 * ROLE_PERMISSIONS — it just checks `permissions[resource]?.[action]`.
 *
 * NOTE: precedence here is per-RESOURCE (an override object replaces the
 * role default for that resource wholesale). can.js/checkPermission resolves
 * per-ACTION. For roles without overrides (e.g. marketer defaults) the two
 * are identical; unifying the two precedence models is a separate cleanup.
 *
 * @param {string} role
 * @param {object} [overridePermissions]  Map<resource, {read,write,delete}>
 * @returns {object}                      Map<resource, {read,write,delete}>
 */
export function getEffectivePermissions(role, overridePermissions = {}) {
  const rolePermissions = ROLE_PERMISSIONS[role] || {};
  const overrides = overridePermissions || {};

  const effective = {};
  const allResources = new Set([
    ...Object.keys(rolePermissions),
    ...Object.keys(overrides),
  ]);

  for (const resource of allResources) {
    effective[resource] = overrides[resource] ||
      rolePermissions[resource] || { read: false, write: false, delete: false };
  }

  return effective;
}

/**
 * Helper: list all roles.
 * @returns {string[]}
 */
export function getAllRoles() {
  return Object.values(ROLES);
}

/**
 * Helper: list all resources.
 * @returns {string[]}
 */
export function getAllResources() {
  return Object.values(RESOURCES);
}
