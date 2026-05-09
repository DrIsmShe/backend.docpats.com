// server/common/auth/roleHierarchy.js
//
// Role seniority hierarchy for assignment safety.
// Prevents privilege escalation: a manager cannot assign admin role.

import { ROLES } from "./permissions.js";

/**
 * Roles ordered from least to most privileged.
 * Index = seniority level.
 */
export const ROLE_HIERARCHY = Object.freeze([
  ROLES.MARKETER,
  ROLES.PHARMACIST,
  ROLES.ACCOUNTANT,
  ROLES.RECEPTIONIST,
  ROLES.NURSE,
  ROLES.DOCTOR,
  ROLES.MANAGER,
  ROLES.ADMIN,
  ROLES.OWNER,
]);

/**
 * Get seniority level of a role (higher = more powerful).
 * Returns -1 if role is unknown.
 * @param {string} role
 * @returns {number}
 */
export function getRoleLevel(role) {
  return ROLE_HIERARCHY.indexOf(role);
}

/**
 * Check if `actorRole` is allowed to assign `targetRole` to someone else.
 * Rule: actor must be STRICTLY senior to target.
 *
 * Examples:
 *   canAssignRole("admin", "doctor")     → true   (admin > doctor)
 *   canAssignRole("admin", "owner")      → false  (admin < owner)
 *   canAssignRole("admin", "admin")      → false  (same level — can't assign equals)
 *   canAssignRole("doctor", "nurse")     → true   (doctor > nurse)
 *   canAssignRole("nurse", "receptionist") → false (same path, nurse not > receptionist)
 *
 * @param {string} actorRole
 * @param {string} targetRole
 * @returns {boolean}
 */
export function canAssignRole(actorRole, targetRole) {
  const actorLevel = getRoleLevel(actorRole);
  const targetLevel = getRoleLevel(targetRole);
  if (actorLevel === -1 || targetLevel === -1) return false;
  return actorLevel > targetLevel;
}

/**
 * Check if `actorRole` is at least as senior as `targetRole` (>=).
 * Useful for "can view" checks where equal-level access is OK.
 * @param {string} actorRole
 * @param {string} targetRole
 * @returns {boolean}
 */
export function isAtLeastSeniorTo(actorRole, targetRole) {
  const actorLevel = getRoleLevel(actorRole);
  const targetLevel = getRoleLevel(targetRole);
  if (actorLevel === -1 || targetLevel === -1) return false;
  return actorLevel >= targetLevel;
}
