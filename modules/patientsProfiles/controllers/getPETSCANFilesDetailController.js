import mongoose from "mongoose";
import PETScan from "../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScan.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

/* ===================== HELPERS ===================== */

const getUserId = (req) =>
  req.userId ||
  req.user?._id ||
  req.user?.userId ||
  req.session?.userId ||
  req.auth?.userId ||
  null;

const getUserRole = (req) =>
  req.role || req.user?.role || req.session?.role || req.auth?.role || null;

const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

const isSameObjectId = (a, b) => {
  if (!a || !b) return false;
  try {
    return new mongoose.Types.ObjectId(a).equals(
      new mongoose.Types.ObjectId(b),
    );
  } catch {
    return false;
  }
};

const pickId = (v) => {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") return v._id || v.id || null;
  return null;
};

/* ===================== CONTROLLER ===================== */

export default async function getPETSCANFilesDetailController(req, res) {
  try {
    const rawUserId = getUserId(req);
    const role = getUserRole(req);

    if (!rawUserId || !toObjectId(rawUserId)) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const userId = toObjectId(rawUserId);
    const anyId = toObjectId(req.params.id);

    if (!anyId) {
      return res.status(400).json({ ok: false, error: "INVALID_PETSCAN_ID" });
    }

    /* ===================== FIND ===================== */

    let doc = await PETScan.findById(anyId)
      .populate("doctor", "role username firstNameEncrypted lastNameEncrypted")
      .populate({
        path: "patientId",
        populate: {
          path: "linkedUserId",
          select: "role username firstNameEncrypted lastNameEncrypted",
        },
      })
      .lean();

    if (!doc) {
      doc = await PETScan.findOne({
        "files.studyReference": anyId,
      })
        .populate(
          "doctor",
          "role username firstNameEncrypted lastNameEncrypted",
        )
        .populate({
          path: "patientId",
          populate: {
            path: "linkedUserId",
            select: "role username firstNameEncrypted lastNameEncrypted",
          },
        })
        .lean();
    }

    if (!doc) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    /* ===================== ACL ===================== */

    const isAdmin = role === "admin" || role === "superadmin";

    const doctorId = pickId(doc.doctor);
    const isDoctorOwner =
      role === "doctor" && doctorId && isSameObjectId(doctorId, userId);

    let isPatientOwner = false;
    let patientCard = null;

    if (role === "patient") {
      patientCard = await NewPatientPolyclinic.findOne({
        linkedUserId: userId,
      }).select("_id linkedUserId");

      if (patientCard) {
        // ✅ новый вариант (карточка пациента)
        const docPatientCardId = pickId(doc.patient) || pickId(doc.patientId);

        if (
          docPatientCardId &&
          isSameObjectId(docPatientCardId, patientCard._id)
        ) {
          isPatientOwner = true;
        }

        // ✅ fallback (старый вариант)
        if (!isPatientOwner) {
          const linkedUserId = pickId(doc?.patientId?.linkedUserId);
          if (linkedUserId && isSameObjectId(linkedUserId, userId)) {
            isPatientOwner = true;
          }
        }
      }
    }

    if (!(isAdmin || isDoctorOwner || isPatientOwner)) {
      return res.status(403).json({
        ok: false,
        error: "FORBIDDEN",
      });
    }

    /* ===================== RESPONSE ===================== */

    return res.status(200).json({
      ok: true,
      item: doc,
    });
  } catch (err) {
    console.error("❌ PET error:", err);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR",
    });
  }
}
