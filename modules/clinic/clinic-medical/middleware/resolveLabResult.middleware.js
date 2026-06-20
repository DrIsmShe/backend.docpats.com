// modules/clinic/clinic-medical/middleware/resolveLabResult.middleware.js
//
// Loads LabResult by :id into req.medicalRecord (mirror of
// resolvePrescription.middleware.js). checkConsent runs AFTER this.

import mongoose from "mongoose";
import LabResult from "../models/labResult.model.js";

export async function resolveLabResult(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid lab result id" });
    }
    const record = await LabResult.findById(id);
    if (!record) {
      return res.status(404).json({ error: "Lab result not found" });
    }
    req.medicalRecord = record;
    next();
  } catch (err) {
    next(err);
  }
}

export default resolveLabResult;
