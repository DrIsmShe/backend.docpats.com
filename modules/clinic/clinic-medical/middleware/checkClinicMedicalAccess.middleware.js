// modules/clinic/clinic-medical/middleware/checkClinicMedicalAccess.middleware.js
//
// Express middleware factory for RBAC checks in clinic-medical routes.
//
// Sprint 2 Phase 2A.
//
// REQUIRES:
//   - tenantMiddleware({ required: true }) must run BEFORE this middleware.
//     req.tenantContext must contain { userId, clinicId, role, actorType }.
//
// USAGE:
//   import { checkClinicMedicalAccess } from "../middleware/checkClinicMedicalAccess.middleware.js";
//   import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
//
//   router.post("/encounters",
//     tenantMiddleware({ required: true }),
//     auditMiddleware({
//       resourceType: "clinic-medical-encounter",
//       action: ACTIONS.ENCOUNTER.CREATE,
//     }),
//     checkClinicMedicalAccess({ action: ACTIONS.ENCOUNTER.CREATE }),
//     resolveClinicPatient,
//     createEncounterController,
//   );
//
// FAILURE MODES:
//   - No tenantContext       → 401 (auth_missing)
//   - No clinicId in context → 403 (no_clinic_context)
//   - Unknown role           → 403 (unknown_role)
//   - Role can't do action   → 403 (insufficient_permission)
//
// All 403 responses include action + role for debugging (NOT for end-user UI —
// frontend should show a generic message).

import { canRolePerform, isKnownRole } from "../rbac/clinicMedicalRBAC.js";

/**
 * @param {object} opts
 * @param {string} opts.action — full audit action name (from ACTIONS.* in clinicMedicalRBAC.js)
 * @returns {function} Express middleware
 */
export function checkClinicMedicalAccess(opts) {
  if (!opts?.action) {
    throw new Error("checkClinicMedicalAccess: 'action' option is required");
  }
  const requiredAction = opts.action;

  return function checkClinicMedicalAccessImpl(req, res, next) {
    const ctx = req.tenantContext;

    // 1. Auth gate — must have tenantContext from tenantMiddleware
    if (!ctx || !ctx.userId) {
      return res.status(401).json({
        error: "Authentication required",
        code: "AUTH_MISSING",
      });
    }

    // 2. Must be inside a clinic (not a personal/freelancer flow)
    if (!ctx.clinicId) {
      return res.status(403).json({
        error: "Clinic context required",
        code: "NO_CLINIC_CONTEXT",
      });
    }

    // 3. Role must exist in matrix
    if (!isKnownRole(ctx.role)) {
      return res.status(403).json({
        error: "Unknown role",
        code: "UNKNOWN_ROLE",
        role: ctx.role,
      });
    }

    // 4. RBAC check
    if (!canRolePerform(ctx.role, requiredAction)) {
      return res.status(403).json({
        error: "Insufficient permissions for this action",
        code: "INSUFFICIENT_PERMISSION",
        action: requiredAction,
        role: ctx.role,
      });
    }

    return next();
  };
}

export default checkClinicMedicalAccess;
