// modules/clinic/clinic-medical/middleware/resolvePrescription.middleware.js
//
// Express middleware: resolve :prescriptionId (or :id) from URL into
// req.medicalRecord. Stage 2 #4.
//
// Mirrors resolveEncounter.middleware.js exactly:
//   - Validates ObjectId
//   - Loads from Prescription model (NOT lean — downstream cancel/complete
//     call .save())
//   - Sets req.medicalRecord + req.medicalRecordId
//
// NOTE: does NOT enforce tenant ownership — that's checkConsent's job.
// Must be followed by checkConsent({ scope: "encounters" }) for reads,
// otherwise any clinic could read any prescription. DO NOT use in isolation.
//
// Why scope "encounters": prescriptions ride on the encounters consent
// scope (no separate prescription scope — see Sprint 3 architecture).

import mongoose from "mongoose";
import Prescription from "../../../../common/models/Polyclinic/Prescription.js";

export async function resolvePrescription(req, res, next) {
  try {
    const key = req.params?.prescriptionId || req.params?.id;

    if (!key) {
      return res.status(400).json({
        error: "Prescription identifier missing in URL",
        code: "PRESCRIPTION_ID_MISSING",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(key)) {
      return res.status(400).json({
        error: "Invalid prescription identifier format",
        code: "INVALID_PRESCRIPTION_ID",
      });
    }

    const prescription = await Prescription.findById(key);

    if (!prescription) {
      return res.status(404).json({
        error: "Prescription not found",
        code: "PRESCRIPTION_NOT_FOUND",
      });
    }

    req.medicalRecord = prescription;
    req.medicalRecordId = String(prescription._id);

    return next();
  } catch (err) {
    console.error("[resolvePrescription] error:", err);
    return res.status(500).json({
      error: "Server error resolving prescription",
      code: "RESOLVE_PRESCRIPTION_ERROR",
    });
  }
}

export default resolvePrescription;
