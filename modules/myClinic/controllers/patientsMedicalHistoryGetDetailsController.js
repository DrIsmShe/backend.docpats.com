// controllers/clinic/patientsMedicalHistoryGetDetailsController.js
import mongoose from "mongoose";
import NewPatientMedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";

/* ======================= uploads helpers ======================= */
const UPLOADS_ORIGIN = (
  process.env.PUBLIC_UPLOADS_ORIGIN || "http://localhost:11000"
).replace(/\/+$/, "");
const uploadsUrl = (p) =>
  `${UPLOADS_ORIGIN}/uploads/${String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^uploads\/+/, "")}`;

const isPlaceholder = (p) => {
  const name = String(p || "")
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^uploads\/+/, "");
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
  if (["female", "f", "woman", "жен", "женщина", "ж"].includes(g)) {
    return "default/default-patient-woman.png";
  }
  if (["male", "m", "man", "муж", "мужчина", "м"].includes(g)) {
    return "default/default-patient-man.png";
  }
  return "default/default-patient.png";
};

const buildPatientPhotoUrl = (patient) => {
  // ⚠️ НЕ обращаемся к patient.profile — его нет в схеме.
  const raw = patient?.photo || "";
  if (/^https?:\/\//i.test(raw)) return raw; // уже абсолютный URL
  if (raw && !isPlaceholder(raw)) return uploadsUrl(raw); // относительный и не плейсхолдер
  return uploadsUrl(pickDefaultByGender(patient?.gender)); // дефолт по полу
};

/* ======================= controller ======================= */
const patientsMedicalHistoryGetDetailsController = async (req, res) => {
  try {
    const { id: _id } = req.params;

    // Валидация id
    if (!_id || !mongoose.Types.ObjectId.isValid(_id)) {
      return res.status(400).json({
        message:
          "Некорректный запрос: отсутствует или неверный ID истории болезни",
      });
    }

    // Ищем документ и подгружаем связанные сущности БЕЗ несуществующих путей
    const mh = await NewPatientMedicalHistory.findById(_id)
      .populate({
        path: "patientId",
        model: NewPatientPolyclinic,
        // Можно явно указать часто используемые поля пациента.
        // Не обязательно: неизвестные поля в select не ломают запрос.
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
        options: { strictPopulate: false },
      })
      .lean();

    if (!mh) {
      return res.status(404).json({ message: "История болезни не найдена" });
    }

    /* ---------- Нормализуем врача (createdBy) ---------- */
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

    /* ---------- Нормализуем пациента (patientId) ---------- */
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
        photo: buildPatientPhotoUrl(p), // абсолютный URL
      };
    }

    // Собираем финальный объект, не меняя общий контракт (без success-обёрток)
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
