// server/modules/mri/controllers/getMRIlFilesDetailController.js
import mongoose from "mongoose";
import MRIScan from "../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScan.js"; // проверь путь
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

/* ===================== helpers ===================== */
const getUserId = (req) =>
  req.userId ||
  req.user?._id ||
  req.session?.userId ||
  req.auth?.userId ||
  null;

const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

/** Безопасный выбор имён (если у User/Patient есть decryptFields) */
function pickDecryptedNames(doc) {
  if (!doc) return { firstName: null, lastName: null };
  if (typeof doc.decryptFields === "function") {
    const d = doc.decryptFields();
    return {
      firstName: d?.firstName ?? doc.firstName ?? null,
      lastName: d?.lastName ?? doc.lastName ?? null,
    };
  }
  return {
    firstName: doc.firstName ?? null,
    lastName: doc.lastName ?? null,
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

/**
 * GET /patient-profile/get-my-mri-file-details/files/:id
 * Возвращает МРТ-исследование с ФИО врача/пациента и ДР пациента.
 */
export default async function getMRIlFilesDetailController(req, res) {
  try {
    // 1) Авторизация
    const rawUserId = getUserId(req);
    const userId = toObjectId(rawUserId);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    // 2) MRI id
    const rawMriId = String(req.params?.id || "").trim();
    const mriId = toObjectId(rawMriId);
    if (!mriId) {
      return res.status(400).json({ ok: false, error: "BAD_MRI_ID" });
    }

    // 3) Карта пациента (привязка к юзеру)
    const patientCard = await NewPatientPolyclinic.findOne(
      { linkedUserId: userId },
      {
        _id: 1,
        firstNameEncrypted: 1,
        lastNameEncrypted: 1,
        dateOfBirth: 1,
        birthDate: 1,
        dob: 1,
        birthday: 1,
      }
    )
      .populate({
        path: "linkedUserId",
        select:
          "role username email firstNameEncrypted lastNameEncrypted dateOfBirth birthDate dob birthday",
      })
      .lean({ getters: false, virtuals: false });

    if (!patientCard?._id) {
      return res
        .status(404)
        .json({ ok: false, error: "PATIENT_CARD_NOT_FOUND" });
    }

    // 4) MRI этого пациента
    const mri = await MRIScan.findOne(
      { _id: mriId, patientId: patientCard._id },
      {
        _id: 1,
        patientId: 1,
        doctor: 1,
        date: 1,

        images: 1,
        rawData: 1,
        pacsLink: 1,
        files: 1,

        nameofexam: 1,
        report: 1,
        diagnosis: 1,
        recomandation: 1,

        contrastUsed: 1,
        imageQuality: 1,
        needsRetake: 1,
        riskLevel: 1,
        riskFactors: 1,

        aiFindings: 1,
        aiConfidence: 1,
        aiVersion: 1,
        aiPrediction: 1,
        predictionConfidence: 1,
        aiProcessingTime: 1,
        aiProcessedAt: 1,

        validatedByDoctor: 1,
        doctorNotes: 1,

        threeDModel: 1,
        createdAt: 1,
        updatedAt: 1,
      }
    )
      .populate({
        path: "doctor",
        select: "_id role username email firstNameEncrypted lastNameEncrypted",
        options: { lean: false },
      })
      .populate({
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
      })
      .lean({ getters: false, virtuals: false });

    if (!mri) {
      return res.status(404).json({ ok: false, error: "MRI_NOT_FOUND" });
    }

    // 5) Имена
    // NB: .lean() выше — но мы запрашивали {lean:false} внутри populate, чтобы оставить методы
    // если .decryptFields недоступен — просто возьмём обычные поля
    const doctorDoc = mri.doctor;
    const patientDoc = mri.patientId;
    const linkedUser = patientDoc?.linkedUserId || null;

    const doctorNames = pickDecryptedNames(doctorDoc);
    const patientCardNames = pickDecryptedNames(patientDoc);
    const patientUserNames = pickDecryptedNames(linkedUser);

    // 6) ДР пациента
    const dobFromUser = pickDOB(linkedUser);
    const dobFromCard = pickDOB(patientDoc);
    const patientDOB = dobFromUser || dobFromCard || null;
    const patientAge = calcAge(patientDOB);

    // 7) Ответ
    const response = {
      id: String(mri._id),
      date: mri.date,

      doctor: doctorDoc
        ? {
            _id: String(doctorDoc._id || doctorDoc),
            role: doctorDoc.role,
            username: doctorDoc.username,
            email: doctorDoc.email ?? null,
            firstName: doctorNames.firstName,
            lastName: doctorNames.lastName,
          }
        : null,

      patientId: patientDoc
        ? {
            _id: String(patientDoc._id),
            linkedUserId: linkedUser
              ? String(linkedUser._id || linkedUser)
              : null,
            firstName: patientUserNames.firstName ?? patientCardNames.firstName,
            lastName: patientUserNames.lastName ?? patientCardNames.lastName,
            dateOfBirth: patientDOB, // ISO-строка или null
            age: patientAge, // число или null
          }
        : null,

      images: Array.isArray(mri.images) ? mri.images : [],
      rawData: mri.rawData || null,
      pacsLink: mri.pacsLink || null,
      files: Array.isArray(mri.files) ? mri.files : [],

      nameofexam: mri.nameofexam || "",
      report: mri.report || "",
      diagnosis: mri.diagnosis || "",
      recomandation: mri.recomandation || "",

      contrastUsed: !!mri.contrastUsed,
      imageQuality:
        typeof mri.imageQuality === "number" ? mri.imageQuality : null,
      needsRetake: !!mri.needsRetake,
      riskLevel: mri.riskLevel || null,
      riskFactors: Array.isArray(mri.riskFactors) ? mri.riskFactors : [],

      aiVersion: mri.aiVersion ?? null,
      aiPrediction: mri.aiPrediction ?? null,
      aiConfidence:
        typeof mri.aiConfidence === "number" ? mri.aiConfidence : null,
      predictionConfidence:
        typeof mri.predictionConfidence === "number"
          ? mri.predictionConfidence
          : null,
      aiProcessingTime:
        typeof mri.aiProcessingTime === "number" ? mri.aiProcessingTime : null,
      aiProcessedAt: mri.aiProcessedAt || null,
      aiFindings: mri.aiFindings ?? null,

      validatedByDoctor: !!mri.validatedByDoctor,
      doctorNotes: mri.doctorNotes || "",

      threeDModel: mri.threeDModel || null,

      createdAt: mri.createdAt,
      updatedAt: mri.updatedAt,
    };

    return res.status(200).json({ ok: true, data: response });
  } catch (err) {
    console.error("[getMRIlFilesDetailController] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "INTERNAL_ERROR", details: err?.message });
  }
}
