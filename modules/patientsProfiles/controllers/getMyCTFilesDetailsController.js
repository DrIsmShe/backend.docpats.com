import mongoose from "mongoose";
import CTScan from "../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScan.js";

/* ========== helpers ========== */
const getUserId = (req) =>
  req.userId ||
  req.user?._id ||
  req.session?.userId ||
  req.auth?.userId ||
  null;

const getUserRole = (req) =>
  req.role || req.user?.role || req.session?.role || req.auth?.role || null;

const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

function pathExists(schema, path) {
  const root = String(path || "").split(".")[0];
  return (
    !!schema.path(path) ||
    !!(schema.virtuals && schema.virtuals[path]) ||
    !!schema.path(root) ||
    !!(schema.virtuals && schema.virtuals[root])
  );
}

const safePopulateSpec = (schema, candidates) =>
  candidates.filter((c) => pathExists(schema, c.path));

/** Безопасный выбор имён (если у User есть decryptFields) */
function pickDecryptedNames(userDoc) {
  if (!userDoc) return { firstName: null, lastName: null };
  if (typeof userDoc.decryptFields === "function") {
    const d = userDoc.decryptFields();
    return {
      firstName: d?.firstName ?? userDoc.firstName ?? null,
      lastName: d?.lastName ?? userDoc.lastName ?? null,
    };
  }
  return {
    firstName: userDoc.firstName ?? null,
    lastName: userDoc.lastName ?? null,
  };
}

/** Возраст по дате рождения */
function calcAge(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

/** Нормализация даты рождения из разных возможных ключей */
function pickDOB(from) {
  if (!from) return null;
  const cand =
    from.dateOfBirth ?? from.birthDate ?? from.birthday ?? from.dob ?? null;
  if (!cand) return null;
  const d = new Date(cand);
  return isNaN(d) ? null : d.toISOString();
}

/* ========== controller ========== */
export default async function getCTlFilesDetailController(req, res) {
  try {
    const rawUserId = getUserId(req);
    const role = getUserRole(req);
    if (!rawUserId || !toObjectId(rawUserId)) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const userId = toObjectId(rawUserId);

    const idParam = String(req.params?.id || "").trim();
    const anyId = toObjectId(idParam);
    if (!anyId) {
      return res.status(400).json({ ok: false, error: "INVALID_CT_ID" });
    }

    const CANDIDATE_POPULATE = [
      {
        path: "doctor",
        select: "role username email firstNameEncrypted lastNameEncrypted",
        options: { lean: false },
      },
      {
        path: "patientId",
        select:
          "linkedUserId firstNameEncrypted lastNameEncrypted dateOfBirth birthDate dob birthday",
        populate: {
          path: "linkedUserId",
          select:
            "role username email firstNameEncrypted lastNameEncrypted dateOfBirth birthDate dob birthday",
          options: { lean: false },
        },
        options: { lean: false },
      },
      { path: "reportTemplate", select: "title", options: { lean: true } },
      { path: "diagnosisTemplate", select: "title", options: { lean: true } },
      {
        path: "recomandationTemplate",
        select: "title",
        options: { lean: true },
      },
      {
        path: "doctorComments.doctor",
        select: "role firstNameEncrypted lastNameEncrypted",
        options: { lean: false },
      },
    ];
    const POPULATE_SPEC = safePopulateSpec(CTScan.schema, CANDIDATE_POPULATE);

    // 1) По _id
    let q = CTScan.findById(anyId).setOptions({ strictPopulate: false });
    for (const p of POPULATE_SPEC) q = q.populate(p);
    let doc = await q.exec();

    // 2) По files.studyReference
    if (!doc) {
      let q2 = CTScan.findOne({ "files.studyReference": anyId }).setOptions({
        strictPopulate: false,
      });
      for (const p of POPULATE_SPEC) q2 = q2.populate(p);
      doc = await q2.exec();
    }

    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    /* ===== ACL ===== */
    const isAdmin = role === "admin" || role === "superadmin";
    const isOwnerDoctor =
      role === "doctor" &&
      doc.doctor &&
      String(doc.doctor?._id || doc.doctor) === String(userId);

    let isOwnerPatient = false;
    if (role === "patient" && doc.patientId?.linkedUserId) {
      const linked = doc.patientId.linkedUserId;
      const linkedId = String(linked?._id || linked);
      if (linkedId && linkedId === String(userId)) isOwnerPatient = true;
    }
    if (!(isAdmin || isOwnerDoctor || isOwnerPatient)) {
      return res.status(403).json({ ok: false, error: "FORBIDDEN" });
    }

    /* ===== Имена (расшифрованы) ===== */
    const doctorNames = pickDecryptedNames(doc.doctor);
    const patientUser =
      doc.patientId && doc.patientId.linkedUserId
        ? doc.patientId.linkedUserId
        : null;
    const patientCardNames = pickDecryptedNames(doc.patientId);
    const patientUserNames = pickDecryptedNames(patientUser);

    /* ===== Дата рождения и возраст пациента ===== */
    const dobFromUser = pickDOB(patientUser);
    const dobFromCard = pickDOB(doc.patientId);
    const patientDOB = dobFromUser || dobFromCard || null;
    const patientAge = calcAge(patientDOB);

    /* ===== Формируем ответ ===== */
    const item = {
      _id: String(doc._id),
      date: doc.date,

      doctor: doc.doctor
        ? {
            _id: String(doc.doctor._id),
            role: doc.doctor.role,
            username: doc.doctor.username,
            email: doc.doctor.email ?? null,
            firstName: doctorNames.firstName,
            lastName: doctorNames.lastName,
          }
        : null,

      patientId: doc.patientId
        ? {
            _id: String(doc.patientId._id),
            linkedUserId: doc.patientId.linkedUserId
              ? String(
                  doc.patientId.linkedUserId._id || doc.patientId.linkedUserId
                )
              : null,
            firstName: patientUserNames.firstName ?? patientCardNames.firstName,
            lastName: patientUserNames.lastName ?? patientCardNames.lastName,
            // ✨ ключи для фронта
            dateOfBirth: patientDOB, // ISO-строка или null
            age: patientAge, // число или null
          }
        : null,

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
      contrastUsed: !!doc.contrastUsed,

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

      threeDModel: doc.threeDModel || null,
      imageQuality: doc.imageQuality ?? null,
      needsRetake: !!doc.needsRetake,
      riskLevel: doc.riskLevel || null,
      riskFactors: Array.isArray(doc.riskFactors) ? doc.riskFactors : [],

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
        ? doc.doctorComments.map((c) => {
            const n = pickDecryptedNames(c.doctor);
            return {
              doctor: c.doctor
                ? {
                    _id: String(c.doctor._id || c.doctor),
                    role: c.doctor.role,
                    firstName: n.firstName,
                    lastName: n.lastName,
                  }
                : null,
              text: c.text || "",
              date: c.date || null,
            };
          })
        : [],

      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };

    return res.status(200).json({ ok: true, item });
  } catch (err) {
    console.error("[getCTlFilesDetailController] error:", err);
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
}
