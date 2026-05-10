// server/common/context/tenantContext.js
//
// AsyncLocalStorage-based per-request context.
// Stores: userId, clinicId, role, permissions, membershipId, actorType.
//
// The context is set once by tenantMiddleware at the start of each request,
// and is automatically propagated through async chains (await, callbacks,
// timers — everything Node's async_hooks tracks).
//
// actorType:
//   "user"     — DocPats public user (doctor or patient) authenticated via session.userId
//   "employee" — Internal clinic staff authenticated via session.employeeId
//   null       — outside auth context (public endpoint, cron, seed)
//
// Note: when actorType is "employee", `userId` field still holds the actor's id
// (the ClinicEmployee._id), so existing code that reads getCurrentUserId() keeps
// working for RBAC and audit purposes. Use getCurrentActorType() to distinguish
// the two cases.
//
// Usage:
//
//   // 1. In middleware (later step):
//   import { runWithTenantContext } from "../context/tenantContext.js";
//   app.use((req, res, next) => {
//     runWithTenantContext({ userId, clinicId, role, permissions, actorType }, () => next());
//   });
//
//   // 2. In service code:
//   import { getCurrentClinicId, getCurrentUserId } from "../context/tenantContext.js";
//   export async function listAppointments() {
//     const clinicId = getCurrentClinicId();
//     return Appointment.find({ clinicId });  // or rely on tenantScoped plugin
//   }
//
//   // 3. In a child logger:
//   const log = childLogger({ ...getTenantContext() });
//   log.info("Doing something");  // logs with userId/clinicId automatically

import { AsyncLocalStorage } from "async_hooks";

/**
 * The single AsyncLocalStorage instance for tenant context.
 * Don't export it directly — only through helper functions below,
 * to keep the API stable.
 */
const tenantContext = new AsyncLocalStorage();

/**
 * Run a function within a tenant context.
 * All async operations inside fn (and their descendants) will see the context.
 *
 * @param {object} ctx  Context object: { userId, clinicId, role, permissions, membershipId, actorType }
 * @param {function} fn  Function to run inside the context
 * @returns {*}  Whatever fn returns
 */
export function runWithTenantContext(ctx, fn) {
  if (typeof fn !== "function") {
    throw new Error("runWithTenantContext: fn must be a function");
  }

  return tenantContext.run(ctx || {}, () => {
    const result = fn();

    // If fn returned a thenable (Promise OR Mongoose Query), wait for it
    // INSIDE the context so context stays alive until the operation completes.
    // Without this, sync arrow callbacks like () => Model.find() lose context
    // because Mongoose returns a lazy Query that resolves later.
    if (result && typeof result.then === "function") {
      return Promise.resolve(result);
    }

    return result;
  });
}

/**
 * Get the full tenant context object, or empty {} if not in a context.
 * @returns {object}
 */
export function getTenantContext() {
  return tenantContext.getStore() || {};
}

/**
 * Get current userId, or null if not authenticated.
 * For employees, this returns the ClinicEmployee._id.
 * @returns {string|null}
 */
export function getCurrentUserId() {
  const ctx = tenantContext.getStore();
  return ctx?.userId || null;
}

/**
 * Get current clinicId, or null if no clinic is selected.
 * @returns {string|null}
 */
export function getCurrentClinicId() {
  const ctx = tenantContext.getStore();
  return ctx?.clinicId || null;
}

/**
 * Get current role within the current clinic, or null.
 * @returns {string|null}  e.g. "owner", "admin", "doctor", ...
 */
export function getCurrentRole() {
  const ctx = tenantContext.getStore();
  return ctx?.role || null;
}

/**
 * Get current permissions object (granular overrides), or {} if none.
 * @returns {object}
 */
export function getCurrentPermissions() {
  const ctx = tenantContext.getStore();
  return ctx?.permissions || {};
}

/**
 * Get current membershipId (link to ClinicMembership document).
 * @returns {string|null}
 */
export function getCurrentMembershipId() {
  const ctx = tenantContext.getStore();
  return ctx?.membershipId || null;
}

/**
 * Get current actor type: "user", "employee", or null when outside context.
 * Use this to distinguish DocPats users from ClinicEmployees when business
 * logic needs to behave differently for the two.
 * @returns {"user"|"employee"|null}
 */
export function getCurrentActorType() {
  const ctx = tenantContext.getStore();
  return ctx?.actorType || null;
}

/**
 * Check if there is an active tenant context (i.e., we're inside a request).
 * Useful for plugins that need to behave differently outside of HTTP context
 * (e.g., during seed scripts, cron jobs).
 * @returns {boolean}
 */
export function hasActiveContext() {
  return tenantContext.getStore() !== undefined;
}

/**
 * Update fields in the current context.
 * USE SPARINGLY — context should normally be set once at request start
 * and not mutated. This is for special cases like switching active clinic
 * mid-request.
 * @param {object} updates  Partial context object
 */
export function updateTenantContext(updates) {
  const ctx = tenantContext.getStore();
  if (!ctx) {
    throw new Error("updateTenantContext: no active context");
  }
  Object.assign(ctx, updates);
}
