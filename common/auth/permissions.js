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
 */
const _basePermissions = {
  [ROLES.ADMIN]: {
    [RESOURCES.CLINIC]: RW,
    [RESOURCES.STAFF]: RO,
    [RESOURCES.STAFF_INVITE]: NONE,
    [RESOURCES.DEPARTMENT]: RO,
    [RESOURCES.ROOM]: RO,
    [RESOURCES.EQUIPMENT]: RO,
    [RESOURCES.KNOWLEDGE]: FULL,
    [RESOURCES.CONSILIUM]: FULL,
    [RESOURCES.TELEMED]: FULL,
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
    [RESOURCES.PATIENT]: RO,
    [RESOURCES.SCHEDULE]: FULL,
    [RESOURCES.APPOINTMENT]: FULL,
    [RESOURCES.QUEUE]: FULL,
    [RESOURCES.CHECKIN]: FULL,
    [RESOURCES.BILLING]: RW,
    [RESOURCES.INVENTORY]: RW,
    [RESOURCES.PHARMACY]: RO,
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
  },

  [ROLES.RECEPTIONIST]: {
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
  },

  [ROLES.MARKETER]: {
    [RESOURCES.ARTICLE]: FULL,
    [RESOURCES.REVIEW]: RW,
    [RESOURCES.SITE_BUILDER]: FULL,
    [RESOURCES.MARKETING]: FULL,
    [RESOURCES.LEAD]: FULL,
    [RESOURCES.ANALYTICS]: RO,
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
