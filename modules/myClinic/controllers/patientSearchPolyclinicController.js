import crypto from "crypto";
import User from "../../../common/models/Auth/users.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";

/* --------------------- Helpers --------------------- */

const sha256Lower = (s = "") =>
  crypto
    .createHash("sha256")
    .update(String(s).trim().toLowerCase())
    .digest("hex");

// 🔥 ДОЛЖЕН БЫТЬ ТОТ ЖЕ normalize что в модели
const normalizePhone = (s = "") => {
  const raw = String(s || "");
  const cleaned = raw.replace(/[^\d]/g, "");
  return cleaned ? `+${cleaned}` : "";
};

/* --------------------- CONTROLLER --------------------- */

const patientSearchPolyclinicController = async (req, res) => {
  try {
    const doctorUserId = req.session?.userId;
    const role = req.session?.role;

    if (!doctorUserId || role !== "doctor") {
      return res.status(403).json({
        status: "error",
        message: "Only doctors can search patients.",
      });
    }

    const raw = String(req.query?.query || "").trim();
    if (!raw) {
      return res.status(400).json({
        status: "error",
        message: "Enter Email or Phone",
      });
    }

    const rawLower = raw.toLowerCase();
    const emailHash = sha256Lower(rawLower);

    const phoneNormalized = normalizePhone(raw);
    const phoneHash = phoneNormalized ? sha256Lower(phoneNormalized) : null;

    /* =====================================================
       1️⃣ SEARCH IN PRIVATE PATIENTS
    ===================================================== */

    const privateOr = [{ emailHash }, { externalId: rawLower }];

    if (phoneHash) privateOr.push({ phoneHash });

    const privatePatient = await DoctorPrivatePatient.findOne({
      doctorUserId,
      isDeleted: false,
      migrationStatus: "private",
      $or: privateOr,
    }).lean();

    if (privatePatient) {
      return res.status(200).json({
        status: "privateFound",
        message: "Patient already exists in your private list.",
        patient: {
          id: privatePatient._id,
        },
      });
    }

    /* =====================================================
       2️⃣ SEARCH IN REGISTERED USERS
    ===================================================== */

    const userOr = [{ emailHash }];
    if (phoneHash) userOr.push({ phoneHash });

    const user = await User.findOne({
      $or: userOr,
      isDeleted: false,
    }).lean();

    if (!user) {
      return res.status(200).json({
        status: "notFound",
        message:
          "Patient is not registered in Docpats. He must create an account.",
      });
    }

    /* =====================================================
       3️⃣ SEARCH POLYCLINIC CARD
    ===================================================== */

    const npc = await NewPatientPolyclinic.findOne({
      linkedUserId: user._id,
      isDeleted: false,
    }).lean();

    if (!npc) {
      return res.status(200).json({
        status: "needsPatientActivation",
        message:
          "Patient is registered but has not activated Polyclinic profile.",
      });
    }

    /* =====================================================
       4️⃣ ATTACH DOCTOR
    ===================================================== */

    const alreadyAttached =
      Array.isArray(npc.doctorId) &&
      npc.doctorId.some((d) => String(d) === String(doctorUserId));

    if (!alreadyAttached) {
      await NewPatientPolyclinic.updateOne(
        { _id: npc._id },
        { $addToSet: { doctorId: doctorUserId } },
      );
    }

    return res.status(200).json({
      status: "attached",
      message: "Patient found and attached.",
      patient: {
        patientId: npc.patientId,
        patientUUID: npc.patientUUID,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (err) {
    console.error("Search patient error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
};

export default patientSearchPolyclinicController;
