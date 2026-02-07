// ======================= SEARCH PATIENT FOR POLYCLINIC =======================

import crypto from "crypto";
import dotenv from "dotenv";
import User from "../../../common/models/Auth/users.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

dotenv.config();

/* --------------------- Helpers --------------------- */
const sha256Lower = (s = "") =>
  crypto
    .createHash("sha256")
    .update(String(s).trim().toLowerCase())
    .digest("hex");

const normalizePhone = (s = "") => {
  const cleaned = String(s).replace(/[^\d+]/g, "");
  const withPlus = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
  return /^\+\d{7,15}$/.test(withPlus) ? withPlus : "";
};

/* --------------------- CONTROLLER --------------------- */

const patientSearchPolyclinicController = async (req, res) => {
  try {
    /* --- check auth --- */
    const doctorId = req.session?.userId;
    const role = req.session?.role;

    if (!doctorId) {
      return res.status(401).json({
        status: "error",
        message: "Please log in.",
      });
    }

    if (role !== "doctor") {
      return res.status(403).json({
        status: "error",
        message: "Only doctors can search patients.",
      });
    }

    /* --- read query --- */
    const raw = String(req.query?.query || "").trim();
    if (!raw) {
      return res.status(400).json({
        status: "error",
        message: "Enter Email, Phone, Document, UUID or PatientID",
      });
    }

    /* --- build search filters --- */
    const emailHash = sha256Lower(raw);
    const phone = normalizePhone(raw);
    const phoneHash = phone ? sha256Lower(phone) : null;

    const or = [
      { emailHash },
      { identityDocument: raw },
      { patientId: raw.toUpperCase() },
      { patientUUID: raw },
    ];

    if (phoneHash) or.push({ phoneHash });

    /* --- 1) search in USERS --- */
    const user = await User.findOne({ $or: or }).lean();

    if (!user) {
      // Пациента нет вообще
      return res.status(200).json({
        status: "notFound",
        message: "Patient is not registered in Docpats.",
      });
    }

    /* --- 2) look for Polyclinic card --- */
    const npc = await NewPatientPolyclinic.findOne({
      linkedUserId: user._id,
    }).lean();

    if (!npc) {
      // Пациент существует в USERS, но НЕ активировал поликлинику
      return res.status(200).json({
        status: "needsPatientActivation",
        message:
          "Patient exists in Docpats but has not activated the Polyclinic account yet.",
        user: {
          id: user._id,
          email: user.email,
        },
      });
    }

    /* --- 3) doctor attaching logic --- */
    const alreadyAttached = npc.doctorId.some(
      (d) => String(d) === String(doctorId)
    );

    if (!alreadyAttached) {
      await NewPatientPolyclinic.updateOne(
        { _id: npc._id },
        { $addToSet: { doctorId } },
        { upsert: false }
      );
    }

    /* --- SUCCESS --- */
    return res.status(200).json({
      status: "attached",
      message: "Patient found and attached to doctor.",
      patient: {
        patientId: npc.patientId,
        patientUUID: npc.patientUUID,
        email: user.email,
        phone: user.phone,
        identityDocument: npc.identityDocument,
      },
    });
  } catch (err) {
    console.error("❌ Error in patient search:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal server error during patient search.",
    });
  }
};

export default patientSearchPolyclinicController;
