import NewPatientPolyclinic from "../models/Polyclinic/newPatientPolyclinic.js";
import DoctorPrivatePatient from "../models/Polyclinic/DoctorPrivatePatient.js";
import mongoose from "mongoose";

const resolvePatient = async (req, res, next) => {
  try {
    const patientKey = req.params.id || req.params.patientId;

    if (!patientKey) {
      return res.status(400).json({ message: "Patient identifier missing" });
    }

    let patient = null;
    let patientType = null;

    // 1️⃣ Пробуем как Mongo _id
    if (mongoose.Types.ObjectId.isValid(patientKey)) {
      patient =
        (await DoctorPrivatePatient.findById(patientKey)) ||
        (await NewPatientPolyclinic.findById(patientKey));

      if (patient) {
        req.patient = patient;
        req.patientType =
          patient.constructor.modelName === "DoctorPrivatePatient"
            ? "private"
            : "registered";
        req.resolvedPatientId = patient._id.toString();
        return next();
      }
    }

    // 2️⃣ Пробуем как patientId (string)
    patient =
      (await DoctorPrivatePatient.findOne({ patientId: patientKey })) ||
      (await NewPatientPolyclinic.findOne({ patientId: patientKey }));

    if (patient) {
      req.patient = patient;
      req.patientType =
        patient.constructor.modelName === "DoctorPrivatePatient"
          ? "private"
          : "registered";
      req.resolvedPatientId = patient._id.toString();
      return next();
    }

    return res.status(404).json({ message: "Пациент не найден" });
  } catch (err) {
    console.error("❌ resolvePatient error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export default resolvePatient;
