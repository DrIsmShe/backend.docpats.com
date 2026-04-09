import mongoose from "mongoose";
import CTScan from "../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScan.js";

/* ===================== helpers ===================== */
const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

const getUserId = (req) =>
  req.userId || req.user?.userId || req.session?.userId || null;

const getUserRole = (req) => req.user?.role || req.session?.role || null;

/* ===================== controller ===================== */
export default async function getCTlFilesDetailController(req, res) {
  try {
    const rawUserId = getUserId(req);
    const role = getUserRole(req);

    if (!rawUserId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const userId = toObjectId(rawUserId);

    const idParam = req.params.id;
    const ctId = toObjectId(idParam);

    if (!ctId) {
      return res.status(400).json({ ok: false, error: "INVALID_CT_ID" });
    }

    /* ===================== FIND ===================== */
    let doc = await CTScan.findById(ctId)
      .populate("doctor", "role username firstNameEncrypted lastNameEncrypted")
      .lean();

    if (!doc) {
      doc = await CTScan.findOne({
        "files.studyReference": ctId,
      })
        .populate(
          "doctor",
          "role username firstNameEncrypted lastNameEncrypted",
        )
        .lean();
    }

    if (!doc) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    /* ===================== ACL ===================== */
    const isAdmin = role === "admin" || role === "superadmin";

    const isDoctorOwner =
      role === "doctor" &&
      doc.doctor &&
      String(doc.doctor._id) === String(userId);

    let isPatientOwner = false;

    if (role === "patient") {
      // 🔥 ВАЖНО: используем patientPolyclinicId из middleware
      const patientPolyclinicId = req.user?.patientPolyclinicId;

      if (
        patientPolyclinicId &&
        doc.patient &&
        String(doc.patient) === String(patientPolyclinicId)
      ) {
        isPatientOwner = true;
      }
    }

    if (!(isAdmin || isDoctorOwner || isPatientOwner)) {
      return res.status(403).json({
        ok: false,
        error: "FORBIDDEN",
        message: "Доступ запрещён",
      });
    }

    /* ===================== RESPONSE ===================== */
    return res.status(200).json({
      ok: true,
      item: {
        _id: doc._id,
        date: doc.date,

        doctor: doc.doctor
          ? {
              _id: doc.doctor._id,
              role: doc.doctor.role,
              username: doc.doctor.username,
            }
          : null,

        patient: doc.patient,
        patientModel: doc.patientModel,

        images: doc.images || [],
        files: doc.files || [],

        nameofexam: doc.nameofexam || "",
        report: doc.report || "",
        diagnosis: doc.diagnosis || "",
        recomandation: doc.recomandation || "",

        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (err) {
    console.error("❌ getCTlFilesDetailController error:", err);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR",
    });
  }
}
