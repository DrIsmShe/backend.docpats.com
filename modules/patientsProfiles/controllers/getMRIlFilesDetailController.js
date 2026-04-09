import mongoose from "mongoose";
import MRIScan from "../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScan.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

/* ===================== HELPERS ===================== */
const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

const getUserId = (req) =>
  req.userId || req.user?.userId || req.session?.userId || null;

const getUserRole = (req) => req.user?.role || req.session?.role || null;

/* ===================== CONTROLLER ===================== */
export default async function getMRIlFilesDetailController(req, res) {
  try {
    /* ===================== AUTH ===================== */
    const rawUserId = getUserId(req);
    const role = getUserRole(req);

    if (!rawUserId) {
      return res.status(401).json({
        ok: false,
        error: "UNAUTHORIZED",
      });
    }

    const userId = toObjectId(rawUserId);
    const mriId = toObjectId(req.params.id);

    if (!mriId) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_MRI_ID",
      });
    }

    /* ===================== FIND MRI ===================== */
    let doc = await MRIScan.findById(mriId)
      .populate("doctor", "role username firstNameEncrypted lastNameEncrypted")
      .lean();

    if (!doc) {
      doc = await MRIScan.findOne({
        "files.studyReference": mriId,
      })
        .populate(
          "doctor",
          "role username firstNameEncrypted lastNameEncrypted",
        )
        .lean();
    }

    if (!doc) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
      });
    }

    /* ===================== ACL ===================== */

    const isAdmin = role === "admin" || role === "superadmin";

    const isDoctorOwner =
      role === "doctor" &&
      doc.doctor &&
      String(doc.doctor._id) === String(userId);

    let isPatientOwner = false;
    let patientPolyclinicId = null;

    if (role === "patient") {
      const patientCard = await NewPatientPolyclinic.findOne({
        linkedUserId: userId,
      }).select("_id");

      if (patientCard) {
        patientPolyclinicId = patientCard._id;

        if (
          doc.patient &&
          new mongoose.Types.ObjectId(doc.patient).equals(patientPolyclinicId)
        ) {
          isPatientOwner = true;
        }
      }
    }

    /* ===================== ACCESS CHECK ===================== */
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
              firstNameEncrypted: doc.doctor.firstNameEncrypted,
              lastNameEncrypted: doc.doctor.lastNameEncrypted,
            }
          : null,

        patient: doc.patient || doc.patientId || null,
        patientModel: doc.patientModel || null,

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
    console.error("❌ getMRIlFilesDetailController error:", err);

    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR",
    });
  }
}
