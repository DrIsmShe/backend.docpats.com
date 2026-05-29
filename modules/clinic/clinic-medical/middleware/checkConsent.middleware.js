// modules/clinic/clinic-medical/middleware/checkConsent.middleware.js
//
// Express middleware: verify that the current clinic has access to a specific
// medical record (encounter / allergy / imaging / etc) for this patient.
//
// Sprint 2 Phase 2A.
//
// ─────────────────────────────────────────────────────────────────────────────
//  ACCESS CHAIN (any of these grants access)
// ─────────────────────────────────────────────────────────────────────────────
//
//   1. OWNERSHIP — record was created by this clinic
//      → record.createdByClinicId.equals(currentClinicId)
//
//   2. PER-RECORD SHARING — patient explicitly shared this record
//      → record.sharedWith.some(id => id.equals(currentClinicId))
//
//   3. GLOBAL CONSENT — patient granted scope-level consent to this clinic
//      → PatientConsent.checkScope(patientRef, currentClinicId, scope) === true
//
// If NONE of these match → 403 ACCESS_DENIED.
//
// ─────────────────────────────────────────────────────────────────────────────
//  USAGE
// ─────────────────────────────────────────────────────────────────────────────
//
// Two modes:
//
// (A) Per-record check — for read/update/delete of a SPECIFIC record.
//     Caller must have populated req.medicalRecord BEFORE this middleware
//     (e.g. via resolveEncounter middleware in Phase 2B).
//
//     router.get("/encounters/:encounterId",
//       tenantMiddleware({ required: true }),
//       checkClinicMedicalAccess({ action: ACTIONS.ENCOUNTER.READ }),  // RBAC
//       resolveEncounter,                                              // sets req.medicalRecord
//       checkConsent({ scope: "encounters" }),                         // ownership/shared/consent
//       encounterReadController,
//     );
//
// (B) Patient-level check — for list/create operations where there's no
//     single record yet. Falls back to global consent check only.
//
//     router.post("/patients/:patientId/encounters",
//       tenantMiddleware({ required: true }),
//       checkClinicMedicalAccess({ action: ACTIONS.ENCOUNTER.CREATE }),
//       resolveClinicPatient,
//       // NB: для create новой записи — клиника СОЗДАЁТ ownership, поэтому
//       // pre-create consent НЕ обязателен. Не подключать checkConsent для CREATE.
//       createEncounterController,
//     );
//
//     router.get("/patients/:patientId/encounters",  // list
//       tenantMiddleware({ required: true }),
//       checkClinicMedicalAccess({ action: ACTIONS.ENCOUNTER.LIST }),
//       resolveClinicPatient,
//       checkConsent({ scope: "encounters", patientLevel: true }),
//       listEncountersController,  // filter results by ownership OR sharedWith OR consent
//     );
//
// ─────────────────────────────────────────────────────────────────────────────
//  PATIENT REF RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────
//
// For patient-level check we need patientRef. Order of resolution:
//   1. req.clinicPatient._id (set by resolveClinicPatient)
//   2. req.medicalRecord.patientRef (if record was resolved first)
//   3. options.patientRefFrom(req) — custom extractor
//
// If neither found → 500 (programmer error — wire up middleware properly).

import mongoose from "mongoose";
import PatientConsent from "../../../../common/models/Polyclinic/PatientConsent.js";
import consentService from "../../clinic-consent/services/consent.service.js";

const VALID_SCOPES = [
  "encounters",
  "allergies",
  "chronicDiseases",
  "operations",
  "familyHistory",
  "immunization",
  "imaging",
];

/**
 * @param {object} opts
 * @param {string} opts.scope — one of VALID_SCOPES
 * @param {boolean} [opts.patientLevel=false] — if true, skip per-record check
 *        and only verify scope-level consent (for list endpoints).
 * @param {function} [opts.patientRefFrom] — (req) => ObjectId — custom resolver
 * @returns {function} Express middleware
 */
export function checkConsent(opts) {
  if (!opts?.scope) {
    throw new Error("checkConsent: 'scope' option is required");
  }
  if (!VALID_SCOPES.includes(opts.scope)) {
    throw new Error(
      `checkConsent: invalid scope '${opts.scope}'. Valid: ${VALID_SCOPES.join(", ")}`,
    );
  }

  const scope = opts.scope;
  const patientLevel = Boolean(opts.patientLevel);

  return async function checkConsentImpl(req, res, next) {
    try {
      const ctx = req.tenantContext;
      if (!ctx?.clinicId) {
        return res.status(401).json({
          error: "Tenant context required",
          code: "NO_CLINIC_CONTEXT",
        });
      }

      const currentClinicId = String(ctx.clinicId);
      const actor = {
        userId: String(ctx.userId),
        role: ctx.role || null,
        email: null, // tenantContext doesn't carry email; auditService will denorm
      };
      const httpContext = {
        ipAddress: req.ip || null,
        userAgent: req.headers?.["user-agent"] || null,
        sessionId: req.sessionID || null,
      };

      // ─── PER-RECORD CHECK ────────────────────────────────────────
      if (!patientLevel) {
        const record = req.medicalRecord;

        if (!record) {
          // Programmer error — middleware wired wrong
          console.error(
            "[checkConsent] per-record mode but req.medicalRecord is missing",
          );
          return res.status(500).json({
            error: "Internal middleware ordering error",
            code: "MIDDLEWARE_CHAIN_ERROR",
          });
        }

        // (1) OWNERSHIP
        if (
          record.createdByClinicId &&
          String(record.createdByClinicId) === currentClinicId
        ) {
          req.consentDecision = { granted: true, reason: "ownership" };
          return next();
        }

        // (2) PER-RECORD SHARING
        if (Array.isArray(record.sharedWith)) {
          const shared = record.sharedWith.some(
            (id) => String(id) === currentClinicId,
          );
          if (shared) {
            req.consentDecision = { granted: true, reason: "shared_with" };
            return next();
          }
        }

        // (3) GLOBAL CONSENT (cross-clinic read fallback)
        if (!record.patientRef) {
          // Record is malformed — bail.
          return res.status(500).json({
            error: "Record missing patientRef — cannot check consent",
            code: "RECORD_MALFORMED",
          });
        }

        const allowed = await consentService.checkScope(
          record.patientRef,
          currentClinicId,
          scope,
          { actor, context: httpContext },
        );

        if (allowed) {
          req.consentDecision = {
            granted: true,
            reason: "global_consent",
            // Hint for controllers: this is a cross-clinic read, audit
            // metadata should include isCrossClinic=true.
            isCrossClinic: true,
          };
          return next();
        }

        return res.status(403).json({
          error: "No consent for this record",
          code: "ACCESS_DENIED",
          scope,
        });
      }

      // ─── PATIENT-LEVEL CHECK (for list endpoints) ────────────────
      let patientRef = null;

      if (req.clinicPatient?._id) {
        patientRef = req.clinicPatient._id;
      } else if (req.medicalRecord?.patientRef) {
        patientRef = req.medicalRecord.patientRef;
      } else if (typeof opts.patientRefFrom === "function") {
        try {
          patientRef = opts.patientRefFrom(req);
        } catch {
          patientRef = null;
        }
      }

      if (!patientRef || !mongoose.isValidObjectId(patientRef)) {
        console.error(
          "[checkConsent] patient-level mode but no patientRef resolved",
        );
        return res.status(500).json({
          error: "Cannot resolve patient for consent check",
          code: "PATIENT_REF_MISSING",
        });
      }

      // At patient-level, ownership/sharedWith are per-record concepts that
      // don't apply globally. Controller will filter results using the
      // same three rules. Here we only verify that at least global consent
      // OR own clinic patient gives baseline access.
      //
      // If patient is owned by this clinic (req.clinicPatient.clinicId matches),
      // controller will still need to filter what records are visible.
      // For now: if patient is in our clinic OR global consent exists,
      // allow the request and let controller filter the response set.

      const patientInOurClinic =
        req.clinicPatient?.clinicId &&
        String(req.clinicPatient.clinicId) === currentClinicId;

      if (patientInOurClinic) {
        req.consentDecision = { granted: true, reason: "own_clinic_patient" };
        return next();
      }

      const allowed = await consentService.checkScope(
        patientRef,
        currentClinicId,
        scope,
        { actor, context: httpContext },
      );

      if (allowed) {
        req.consentDecision = {
          granted: true,
          reason: "global_consent",
          isCrossClinic: true,
        };
        return next();
      }

      return res.status(403).json({
        error: "No consent for this patient's data",
        code: "ACCESS_DENIED",
        scope,
      });
    } catch (err) {
      console.error("[checkConsent] error:", err);
      return res.status(500).json({
        error: "Server error during consent check",
        code: "CONSENT_CHECK_ERROR",
      });
    }
  };
}

export default checkConsent;
export { VALID_SCOPES };
