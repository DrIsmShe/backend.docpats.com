// modules/clinic/clinic-medical/middleware/resolveClinicPatient.middleware.js
//
// Express middleware: resolve :patientId from URL into req.clinicPatient.
//
// Sprint 2 Phase 2A.
//
// Differences from myClinic's resolvePatient:
//   - ONLY ClinicPatient model (not DoctorPrivatePatient / NewPatientPolyclinic)
//   - Tenant isolation is AUTOMATIC via tenantScopedPlugin — we don't need to
//     manually add { clinicId: ctx.clinicId } to the query. The plugin uses
//     AsyncLocalStorage from runWithTenantContext (set by tenantMiddleware).
//     A patient from another clinic returns null even if you query by _id.
//   - Sets req.clinicPatient (the document) and req.clinicPatientId (string).
//   - For backwards-compat with code expecting req.patient/req.patientType,
//     also sets req.patient = req.clinicPatient + req.patientType = "clinic-patient".
//
// REQUIRES:
//   - tenantMiddleware({ required: true }) must run BEFORE — for tenant scope.
//
// RESPONSE CODES:
//   400 — bad/missing patientId
//   404 — patient not found (or belongs to another clinic — same as not found
//         to prevent enumeration attacks)
//   500 — internal error

import mongoose from "mongoose";
import ClinicPatient from "../../clinic-patients/models/clinicPatient.model.js";

export async function resolveClinicPatient(req, res, next) {
  try {
    // Accept both :patientId and :id (router author's choice)
    const patientKey = req.params?.patientId || req.params?.id;

    if (!patientKey) {
      return res.status(400).json({
        error: "Patient identifier missing in URL",
        code: "PATIENT_ID_MISSING",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(patientKey)) {
      return res.status(400).json({
        error: "Invalid patient identifier format",
        code: "INVALID_PATIENT_ID",
      });
    }

    // tenantScopedPlugin auto-injects clinicId filter from AsyncLocalStorage.
    // If patient belongs to a different clinic — returns null.
    const patient = await ClinicPatient.findById(patientKey);

    if (!patient) {
      // Could be: doesn't exist OR cross-tenant attempt OR soft-deleted.
      // Treat all three as 404 (don't leak existence).
      return res.status(404).json({
        error: "Patient not found",
        code: "PATIENT_NOT_FOUND",
      });
    }

    // Primary handles (clinic-medical-style)
    req.clinicPatient = patient;
    req.clinicPatientId = String(patient._id);

    // Compatibility handles — so code mirrored from myClinic still works
    // (encounter controller expects req.patient + req.patientType).
    req.patient = patient;
    req.patientType = "clinic-patient";
    req.patientTypeModel = "ClinicPatient";
    req.resolvedPatientId = String(patient._id);

    return next();
  } catch (err) {
    console.error("[resolveClinicPatient] error:", err);
    return res.status(500).json({
      error: "Server error resolving patient",
      code: "RESOLVE_PATIENT_ERROR",
    });
  }
}

export default resolveClinicPatient;
