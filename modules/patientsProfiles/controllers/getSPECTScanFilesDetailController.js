import mongoose from "mongoose";
import SPECTScan from "../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScan.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

/* ===================== HELPERS ===================== */

const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

const getUserId = (req) =>
  req.userId ||
  req.user?._id ||
  req.user?.userId ||
  req.session?.userId ||
  req.auth?.userId ||
  null;

const getUserRole = (req) =>
  req.role || req.user?.role || req.session?.role || req.auth?.role || null;

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

const pickId = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") return value._id || value.id || null;
  return null;
};

/* ===================== CONTROLLER ===================== */

export default async function getSPECTScanFilesDetailController(req, res) {
  try {
    const rawUserId = getUserId(req);
    const role = getUserRole(req);

    if (!rawUserId) {
      return res.status(401).json({
        ok: false,
        error: "UNAUTHORIZED",
      });
    }

    const userId = toObjectId(rawUserId);
    const spectId = toObjectId(req.params.id);

    if (!spectId) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_SPECT_ID",
      });
    }

    /* ===================== FIND DOCUMENT ===================== */

    let doc = await SPECTScan.findById(spectId)
      .populate("doctor", "role username firstNameEncrypted lastNameEncrypted")
      .populate({
        path: "patientId",
        select:
          "_id linkedUserId firstNameEncrypted lastNameEncrypted dateOfBirth birthDate dob birthday",
        populate: {
          path: "linkedUserId",
          select: "_id role username firstNameEncrypted lastNameEncrypted",
        },
      })
      .lean();

    if (!doc) {
      doc = await SPECTScan.findOne({ "files.studyReference": spectId })
        .populate(
          "doctor",
          "role username firstNameEncrypted lastNameEncrypted",
        )
        .populate({
          path: "patientId",
          select:
            "_id linkedUserId firstNameEncrypted lastNameEncrypted dateOfBirth birthDate dob birthday",
          populate: {
            path: "linkedUserId",
            select: "_id role username firstNameEncrypted lastNameEncrypted",
          },
        })
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
        // Новый стиль: patient / patientId хранит карточку пациента
        const docPatientCardId = pickId(doc.patient) || pickId(doc.patientId);

        if (
          docPatientCardId &&
          isSameObjectId(docPatientCardId, patientCard._id)
        ) {
          isPatientOwner = true;
        }

        // Старый fallback: patientId.linkedUserId хранит самого юзера
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
        message: "Доступ запрещён",
      });
    }

    /* ===================== RESPONSE ===================== */

    const item = {
      _id: doc._id,
      date: doc.date || null,

      doctor: doc.doctor
        ? {
            _id: pickId(doc.doctor),
            role: doc.doctor.role || null,
            username: doc.doctor.username || "",
            firstNameEncrypted: doc.doctor.firstNameEncrypted || "",
            lastNameEncrypted: doc.doctor.lastNameEncrypted || "",
          }
        : null,

      patientId: doc.patientId
        ? {
            _id: pickId(doc.patientId),
            linkedUserId: pickId(doc.patientId.linkedUserId),
            firstNameEncrypted: doc.patientId.firstNameEncrypted || "",
            lastNameEncrypted: doc.patientId.lastNameEncrypted || "",
            dateOfBirth:
              doc.patientId.dateOfBirth ||
              doc.patientId.birthDate ||
              doc.patientId.dob ||
              doc.patientId.birthday ||
              null,
          }
        : null,

      patient: doc.patient || null,
      patientModel: doc.patientModel || null,

      images: Array.isArray(doc.images) ? doc.images : [],
      rawData: doc.rawData || null,
      pacsLink: doc.pacsLink || null,

      files: Array.isArray(doc.files)
        ? doc.files.map((f) => ({
            fileName: f.fileName,
            fileType: f.fileType,
            fileUrl: f.fileUrl,
            fileSize: f.fileSize,
            fileFormat: f.fileFormat,
            studyReference: f.studyReference ? String(f.studyReference) : null,
            studyTypeReference: f.studyTypeReference || null,
          }))
        : [],

      nameofexam: doc.nameofexam || "",
      report: doc.report || "",
      recomandation: doc.recomandation || "",
      diagnosis: doc.diagnosis || "",

      radiationDose: doc.radiationDose ?? null,
      bodyPart: doc.bodyPart || "",

      previousStudy: doc.previousStudy ? String(doc.previousStudy) : null,
      relatedStudies: Array.isArray(doc.relatedStudies)
        ? doc.relatedStudies.map((x) => String(x))
        : [],

      aiFindings: doc.aiFindings ?? null,
      aiConfidence: doc.aiConfidence ?? null,
      aiVersion: doc.aiVersion ?? null,
      aiPrediction: doc.aiPrediction ?? null,
      predictionConfidence: doc.predictionConfidence ?? null,
      aiProcessingTime: doc.aiProcessingTime ?? null,
      aiProcessedAt: doc.aiProcessedAt ?? null,

      validatedByDoctor: !!doc.validatedByDoctor,
      doctorNotes: doc.doctorNotes || "",

      imageQuality: doc.imageQuality ?? null,
      needsRetake: !!doc.needsRetake,
      riskLevel: doc.riskLevel || null,
      riskFactors: Array.isArray(doc.riskFactors) ? doc.riskFactors : [],

      nameofexamTemplate: doc.nameofexamTemplate
        ? {
            _id: String(doc.nameofexamTemplate._id),
            title: doc.nameofexamTemplate.title,
          }
        : null,
      reportTemplate: doc.reportTemplate
        ? {
            _id: String(doc.reportTemplate._id),
            title: doc.reportTemplate.title,
          }
        : null,
      diagnosisTemplate: doc.diagnosisTemplate
        ? {
            _id: String(doc.diagnosisTemplate._id),
            title: doc.diagnosisTemplate.title,
          }
        : null,
      recomandationTemplate: doc.recomandationTemplate
        ? {
            _id: String(doc.recomandationTemplate._id),
            title: doc.recomandationTemplate.title,
          }
        : null,

      doctorComments: Array.isArray(doc.doctorComments)
        ? doc.doctorComments.map((c) => ({
            doctor: c.doctor
              ? {
                  _id: pickId(c.doctor),
                  role: c.doctor.role || null,
                  firstNameEncrypted: c.doctor.firstNameEncrypted || "",
                  lastNameEncrypted: c.doctor.lastNameEncrypted || "",
                }
              : null,
            text: c.text || "",
            date: c.date || null,
          }))
        : [],

      createdAt: doc.createdAt || null,
      updatedAt: doc.updatedAt || null,
    };

    return res.status(200).json({
      ok: true,
      item,
    });
  } catch (err) {
    console.error("❌ getSPECTScanFilesDetailController error:", err);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR",
    });
  }
}
