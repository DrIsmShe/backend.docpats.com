// modules/clinic/clinic-medical/middleware/resolveEncounter.middleware.js
//
// Express middleware: resolve :encounterId from URL into req.medicalRecord.
//
// Sprint 2 Phase 2B.
//
// Behavior:
//   - Validates ObjectId
//   - Loads encounter from newPatientMedicalHistory (UMR model)
//   - Sets req.medicalRecord (mongoose document, not lean)
//   - Sets req.medicalRecordId (string)
//
// Why not lean: downstream middleware (checkConsent) and controllers may
// need to call .save() on the document for sign/amend/update operations.
// Lean would force re-fetch.
//
// NOTE: This middleware does NOT enforce tenant ownership — that's the
// job of checkConsent which knows the full access chain (ownership /
// sharedWith / consent). Without checkConsent following this middleware,
// any clinic could read any encounter — DO NOT use this in isolation.

import mongoose from "mongoose";
import NewPatientMedicalHistory from "../../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";

export async function resolveEncounter(req, res, next) {
  try {
    const encounterKey = req.params?.encounterId || req.params?.id;

    if (!encounterKey) {
      return res.status(400).json({
        error: "Encounter identifier missing in URL",
        code: "ENCOUNTER_ID_MISSING",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(encounterKey)) {
      return res.status(400).json({
        error: "Invalid encounter identifier format",
        code: "INVALID_ENCOUNTER_ID",
      });
    }

    const encounter = await NewPatientMedicalHistory.findById(encounterKey);

    if (!encounter) {
      return res.status(404).json({
        error: "Encounter not found",
        code: "ENCOUNTER_NOT_FOUND",
      });
    }

    req.medicalRecord = encounter;
    req.medicalRecordId = String(encounter._id);

    return next();
  } catch (err) {
    console.error("[resolveEncounter] error:", err);
    return res.status(500).json({
      error: "Server error resolving encounter",
      code: "RESOLVE_ENCOUNTER_ERROR",
    });
  }
}

export default resolveEncounter;
