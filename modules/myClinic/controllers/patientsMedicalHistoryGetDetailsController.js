// controllers/clinic/patientsMedicalHistoryGetDetailsController.js
import mongoose from "mongoose";
import NewPatientMedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";

/* ======================== R2 helpers ======================== */

const R2_PUBLIC = (
  process.env.R2_PUBLIC_URL ||
  "https://pub-02fd367c4d0849cab12ceeb5bb357124.r2.dev"
).replace(/\/+$/, "");

const normalizeUploadsPath = (p) =>
  String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^uploads\/+/, "");

const toUploadsUrl = (p) => `${R2_PUBLIC}/uploads/${normalizeUploadsPath(p)}`;

const isPlaceholder = (p) => {
  const name = normalizeUploadsPath(p).toLowerCase();
  return (
    !name ||
    name === "default.png" ||
    name === "default.jpg" ||
    name.startsWith("default/")
  );
};

const pickDefaultByGender = (gender) => {
  const g = String(gender || "")
    .trim()
    .toLowerCase();
  if (["female", "f", "woman", "жен", "женщина", "ж"].includes(g))
    return "default/default-patient-woman.png";
  if (["male", "m", "man", "муж", "мужчина", "м"].includes(g))
    return "default/default-patient-man.png";
  return "default/default-patient.png";
};

const buildPatientPhotoUrl = (patient) => {
  const raw = patient?.photo || "";

  if (/^https?:\/\//i.test(raw)) {
    if (/r2\.dev|cloudflarestorage\.com/i.test(raw)) return raw;
    return toUploadsUrl(pickDefaultByGender(patient?.gender));
  }

  if (raw && !isPlaceholder(raw)) return toUploadsUrl(raw);

  return toUploadsUrl(pickDefaultByGender(patient?.gender));
};

/* ============================ Controller ============================ */

const patientsMedicalHistoryGetDetailsController = async (req, res) => {
  try {
    const { id: _id } = req.params;

    if (!_id || !mongoose.Types.ObjectId.isValid(_id)) {
      return res.status(400).json({
        message:
          "Некорректный запрос: отсутствует или неверный ID истории болезни",
      });
    }

    const mh = await NewPatientMedicalHistory.findById(_id)
      .populate({
        path: "patientId",
        model: NewPatientPolyclinic,
        select:
          "firstName lastName gender birthDate country badHabits immunization familyHistoryOfDisease chronicDiseases allergies photo",
        options: { strictPopulate: false },
      })
      .populate({
        path: "createdBy",
        select:
          "firstNameEncrypted lastNameEncrypted emailEncrypted _id specialization",
        populate: {
          path: "specialization",
          select: "name",
          options: { strictPopulate: false },
        },
      })
      .lean();

    if (!mh) {
      return res.status(404).json({ message: "История болезни не найдена" });
    }

    // Врач
    let doctor = null;
    if (mh.createdBy) {
      doctor = {
        _id: mh.createdBy._id,
        firstName: decrypt(mh.createdBy.firstNameEncrypted),
        lastName: decrypt(mh.createdBy.lastNameEncrypted),
        email: decrypt(mh.createdBy.emailEncrypted),
        specialization: mh.createdBy.specialization?.name || "Неизвестно",
      };
    }

    // Пациент → фото всегда R2
    let patient = null;
    if (mh.patientId) {
      const p = mh.patientId;
      patient = {
        _id: p._id,
        firstName: p.firstName,
        lastName: p.lastName,
        gender: p.gender,
        birthDate: p.birthDate,
        country: p.country,
        badHabits: p.badHabits,
        immunization: p.immunization,
        familyHistoryOfDisease: p.familyHistoryOfDisease,
        chronicDiseases: p.chronicDiseases,
        allergies: p.allergies,
        photo: buildPatientPhotoUrl(p),
      };
    }

    // Финальный объект
    const out = {
      ...mh,
      createdBy: doctor,
      patientId: patient,
    };

    return res.status(200).json(out);
  } catch (err) {
    console.error("❌ Ошибка при получении истории болезни пациента:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

export default patientsMedicalHistoryGetDetailsController;
