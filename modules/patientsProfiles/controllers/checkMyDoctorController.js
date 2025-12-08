// server/modules/patientProfile/controllers/checkMyDoctorController.js
import mongoose from "mongoose";
import User from "../../../common/models/Auth/users.js";

const toOID = (v) =>
  mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(v) : null;
const getPatientId = (req) =>
  req.session?.userId ||
  req.userId ||
  req.user?._id ||
  req.auth?.userId ||
  null;

export async function checkMyDoctor(req, res) {
  try {
    const patientId = getPatientId(req);
    const { doctorId } = req.params;
    const { alt } = req.query || {};

    if (!patientId) {
      return res
        .status(401)
        .json({ isAdded: false, message: "Пациент не авторизован." });
    }
    if (!doctorId && !alt) {
      return res.status(200).json({ isAdded: false });
    }

    const rawCandidates = [doctorId, alt].filter(Boolean).map(String);
    const oidCandidates = rawCandidates.map(toOID).filter(Boolean);

    const patient = await User.findById(patientId).lean();
    if (!patient || !Array.isArray(patient.myDoctors)) {
      return res.status(200).json({ isAdded: false });
    }

    const arr = patient.myDoctors;

    const has = arr.some((it) => {
      // примитив (строка/ObjectId)
      if (typeof it === "string" || mongoose.isValidObjectId(it)) {
        const s = String(it);
        return (
          rawCandidates.includes(s) ||
          oidCandidates.some((oid) => String(oid) === s)
        );
      }
      // поддокументы
      if (it && typeof it === "object") {
        const cands = [it.doctor, it.profileId].filter(Boolean).map(String);
        return cands.some(
          (c) =>
            rawCandidates.includes(c) ||
            oidCandidates.some((oid) => String(oid) === c)
        );
      }
      return false;
    });

    return res.status(200).json({ isAdded: has });
  } catch (e) {
    console.error("checkMyDoctor error:", e);
    return res.status(200).json({ isAdded: false });
  }
}
