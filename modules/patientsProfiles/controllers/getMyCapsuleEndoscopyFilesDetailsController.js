import mongoose from "mongoose";
import CapsuleEndoscopyScan from "../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScan.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

/* ===================== HELPERS ===================== */

const getUserId = (req) =>
  req.userId || req.user?._id || req.session?.userId || null;

const getUserRole = (req) =>
  req.role || req.user?.role || req.session?.role || null;

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

/* ===================== FIND HELPER ===================== */

const findCapsuleScan = async (idParam) => {
  const anyId = toObjectId(idParam);

  console.log("🔍 SEARCH ID:", idParam);
  console.log("🔍 AS ObjectId:", anyId);

  let doc = null;

  // 1. поиск по _id
  if (anyId) {
    doc = await CapsuleEndoscopyScan.findById(anyId)
      .populate("doctor", "role username firstNameEncrypted lastNameEncrypted")
      .populate({
        path: "patientId",
        populate: {
          path: "linkedUserId",
          select: "role username firstNameEncrypted lastNameEncrypted",
        },
      })
      .lean();

    if (doc) {
      console.log("✅ FOUND BY _id");
      return doc;
    }
  }

  // 2. поиск по files.studyReference (ВСЕ ВАРИАНТЫ)
  doc = await CapsuleEndoscopyScan.findOne({
    files: {
      $elemMatch: {
        $or: [
          { studyReference: anyId },
          { studyReference: idParam },
          { studyReference: String(idParam) },
        ],
      },
    },
  })
    .populate("doctor", "role username firstNameEncrypted lastNameEncrypted")
    .populate({
      path: "patientId",
      populate: {
        path: "linkedUserId",
        select: "role username firstNameEncrypted lastNameEncrypted",
      },
    })
    .lean();

  if (doc) {
    console.log("✅ FOUND BY studyReference");
    return doc;
  }

  console.log("❌ NOT FOUND ANYWHERE");

  return null;
};

/* ===================== CONTROLLER ===================== */

export default async function getMyCapsuleEndoscopyFilesDetailsController(
  req,
  res,
) {
  try {
    const rawUserId = getUserId(req);
    const role = getUserRole(req);

    if (!rawUserId || !toObjectId(rawUserId)) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const userId = toObjectId(rawUserId);
    const idParam = String(req.params.id || "").trim();

    if (!idParam) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_CAPSULE_ENDOSCOPY_ID",
      });
    }

    /* ===================== FIND ===================== */

    const doc = await findCapsuleScan(idParam);

    if (!doc) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
      });
    }

    /* ===================== ACL ===================== */

    const isAdmin = role === "admin" || role === "superadmin";

    const doctorId = pickId(doc.doctor);
    const isDoctorOwner =
      role === "doctor" && doctorId && isSameObjectId(doctorId, userId);

    let isPatientOwner = false;

    if (role === "patient") {
      const patientCard = await NewPatientPolyclinic.findOne({
        linkedUserId: userId,
      }).select("_id linkedUserId");

      if (patientCard) {
        // ✅ новый вариант (через карточку пациента)
        const docPatientCardId = pickId(doc.patient) || pickId(doc.patientId);

        if (
          docPatientCardId &&
          isSameObjectId(docPatientCardId, patientCard._id)
        ) {
          isPatientOwner = true;
        }

        // ✅ fallback старый вариант
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
    console.error("❌ Capsule error:", err);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR",
    });
  }
}
