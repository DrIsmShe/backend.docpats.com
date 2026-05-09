// server/common/auth/can.js
//
// Permission check helpers built on top of tenantContext.
//
// Three flavors:
//   - can(resource, action)       → boolean (uses current context)
//   - require(resource, action)   → throws ForbiddenError if denied
//   - canFor(membership, ...)     → boolean (no context needed; for sockets, jobs)
//
// Usage:
//
//   import { can, require } from "../../common/auth/can.js";
//
//   // 1. Boolean check inside service:
//   if (can("patient", "write")) { ... }
//
//   // 2. Throwing variant for short-circuit:
//   require("billing", "delete");
//
//   // 3. With dot-notation:
//   if (can("staff.read")) { ... }
//
//   // 4. In socket handler (no req, but you have membership object):
//   if (canFor(socket.tenant, "appointment", "write")) { ... }

import {
  getCurrentRole,
  getCurrentPermissions,
} from "../context/tenantContext.js";
import { ROLE_PERMISSIONS, ACTIONS } from "./permissions.js";
import { ForbiddenError } from "../utils/errors.js";

/**
 * Internal: parse "resource.action" or accept (resource, action) separately.
 * @returns {[string, string]}
 */
function parseArgs(resource, action) {
  if (
    action === undefined &&
    typeof resource === "string" &&
    resource.includes(".")
  ) {
    const parts = resource.split(".");
    if (parts.length !== 2) {
      throw new Error(`can(): invalid resource.action syntax: "${resource}"`);
    }
    return parts;
  }
  if (typeof resource !== "string" || typeof action !== "string") {
    throw new Error(
      `can(): expected (resource, action) strings, got (${resource}, ${action})`,
    );
  }
  return [resource, action];
}

/**
 * Internal: check permission given a role + override permissions.
 * @returns {boolean}
 */
function checkPermission(role, overridePerms, resource, action) {
  // 1. Override permissions (admin set custom permissions for this user)
  if (
    overridePerms &&
    Object.prototype.hasOwnProperty.call(overridePerms, resource)
  ) {
    const resourcePerm = overridePerms[resource];
    if (
      resourcePerm &&
      Object.prototype.hasOwnProperty.call(resourcePerm, action)
    ) {
      return Boolean(resourcePerm[action]);
    }
  }

  // 2. Default permissions for the role
  const rolePerms = ROLE_PERMISSIONS[role];
  if (!rolePerms) return false;
  const resourcePerm = rolePerms[resource];
  if (!resourcePerm) return false;
  return Boolean(resourcePerm[action]);
}

/**
 * Check if current user (from tenant context) can perform action on resource.
 * Uses role + override permissions from context.
 *
 * @param {string} resource  e.g. "patient" or "patient.read"
 * @param {string} [action]  e.g. "read" (omit if dot-notation used)
 * @returns {boolean}
 */
export function can(resource, action) {
  const [res, act] = parseArgs(resource, action);
  const role = getCurrentRole();
  if (!role) return false;
  const overridePerms = getCurrentPermissions();
  return checkPermission(role, overridePerms, res, act);
}

/**
 * Like `can()`, but throws ForbiddenError if denied.
 * Use in service code for guard-style enforcement.
 *
 * @param {string} resource
 * @param {string} [action]
 * @throws {ForbiddenError}
 */
export function require(resource, action) {
  const [res, act] = parseArgs(resource, action);
  if (!can(res, act)) {
    throw new ForbiddenError(`Permission denied: ${res}.${act}`, {
      required: `${res}.${act}`,
    });
  }
}

/**
 * Like `can()`, but with explicit membership object instead of context.
 * Use in places where there's no AsyncLocalStorage context:
 *   - Socket.IO event handlers (have socket.tenant)
 *   - Background jobs that processed user's membership
 *   - Tests
 *
 * @param {object} membership  { role, permissions }
 * @param {string} resource
 * @param {string} [action]
 * @returns {boolean}
 */
export function canFor(membership, resource, action) {
  if (!membership || !membership.role) return false;
  const [res, act] = parseArgs(resource, action);
  return checkPermission(
    membership.role,
    membership.permissions || {},
    res,
    act,
  );
}

/**
 * Throwing version of canFor.
 * @throws {ForbiddenError}
 */
export function requireFor(membership, resource, action) {
  const [res, act] = parseArgs(resource, action);
  if (!canFor(membership, res, act)) {
    throw new ForbiddenError(`Permission denied: ${res}.${act}`, {
      required: `${res}.${act}`,
    });
  }
}

/**
 * Compact API: re-export ACTIONS so callers can use can("patient", ACTIONS.READ).
 */
export { ACTIONS } from "./permissions.js";
