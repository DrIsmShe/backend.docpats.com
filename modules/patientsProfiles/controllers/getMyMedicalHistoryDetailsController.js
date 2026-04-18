// controllers/patient-profile/getMyMedicalHistoryDetailsController.js
import mongoose from "mongoose";
import newPatientMedicalHistoryModel from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";

/* ========== подстрахуемся пустыми схемами (чтобы populate не падал) ========== */
const safeModel = (name) => {
  if (!mongoose.models[name]) {
    mongoose.model(name, new mongoose.Schema({}, { strict: false }));
  }
};
[
  "NewPatientPolyclinic",
  "allergiesPatient",
  "familyHistoryOfDiseasePatient",
  "operationsPatient",
  "chronicDiseasesPatient",
  "immunizationPatient",
  "File",
  "Specialization",
  "DoctorProfile",
].forEach(safeModel);

/* ========== helpers: uploads & gender ========== */
const toRelativeUpload = (p) => {
  const s = String(p || "")
    .replace(/\\/g, "/")
    .trim();
  if (!s) return "";
  const m = s.match(/\/uploads\/(.+)$/i);
  if (m) return m[1];
  return s.replace(/^\/+/, "").replace(/^uploads\/+/, "");
};

const isPlaceholder = (p) => {
  const n = toRelativeUpload(p).toLowerCase();
  return (
    !n || n === "default.png" || n === "default.jpg" || n.startsWith("default/")
  );
};

const pickDefaultByGender = (g) => {
  const s = String(g || "").trim().toLowerCase();
  if (
    ["female", "f", "woman", "жен", "женщина", "ж", "qadin", "qadın", "kadın", "kadin"].includes(s)
  )
    return "default/default-patient-woman.png";
  if (
    ["male", "m", "man", "м", "муж", "мужчина", "kişi", "kisi", "erkek"].includes(s)
  )
    return "default/default-patient-man.png";
  return "default/default-patient.png";
};

const buildPhotoRelative = (patient, rawGender) => {
  const rel = toRelativeUpload(patient?.photo || "");
  if (rel && !isPlaceholder(rel)) return rel;
  return pickDefaultByGender(rawGender);
};

const ruGender = (g) => {
  const s = String(g || "").trim().toLowerCase();
  if (
    ["male", "m", "man", "м", "муж", "мужчина", "мужской", "kişi", "kisi", "erkek"].includes(s)
  )
    return "Мужской";
  if (
    ["female", "f", "woman", "ж", "жен", "женщина", "женский", "qadin", "qadın", "kadin", "kadın"].includes(s)
  )
    return "Женский";
  return s || "—";
};

/** Безопасная расшифровка — ловит ошибки от битых ключей */
const safeDecrypt = (val) => {
  if (!val) return null;
  try {
    return decrypt(val) || null;
  } catch (e) {
    return null;
  }
};

/** Берём пол из любых разумных ключей, включая User.bio */
const pickRawGender = (p = {}) => {
  const candidates = [
    p.gender,
    p.bio,
    p.BIO,
    // если популятили linkedUserId/userId → это User-документ
    p.linkedUserId?.gender,
    p.linkedUserId?.bio,
    p.userId?.gender,
    p.userId?.bio,
    // запасные имена
    p.sex,
    p.genderText,
    p.gender_ru,
    p.genderEn,
  ];
  for (const v of candidates) {
    if (v != null && String(v).trim() !== "") return v;
  }
  return "";
};

/** Превращает массив в строку или возвращает строку как есть */
const arrToStr = (v) => {
  if (v == null) return "";
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "object" ? x?.name || x?.title || "" : String(x)))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof v === "object") return v?.name || v?.title || "";
  return String(v);
};

/* ========== controller ========== */
const getMyMedicalHistoryDetailsController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Неверный формат ID истории болезни",
      });
    }

    /* ────────────────────────────────────────────────
       ВАЖНО: в БД MedicalHistory поле называется `patientRef`,
       а модель пациента указана в `patientTypeModel`
       (например: "NewPatientPolyclinic").
       Поэтому используем refPath-стиль: populate с динамической моделью.
       ──────────────────────────────────────────────── */
    const history = await newPatientMedicalHistoryModel
      .findById(id)
      // автор записи
      .populate({
        path: "createdBy",
        select: "firstNameEncrypted lastNameEncrypted",
        options: { strictPopulate: false },
      })
      // лечащий врач
      .populate({
        path: "doctorId",
        select: "firstNameEncrypted lastNameEncrypted specialization",
        populate: {
          path: "specialization",
          select: "name",
          options: { strictPopulate: false },
        },
        options: { strictPopulate: false },
      })
      // профиль врача
      .populate({
        path: "doctorProfileId",
        select: "position workplace educationInstitution profileImage",
        options: { strictPopulate: false },
      })
      // ✅ ПАЦИЕНТ — patientRef + linkedUserId внутри
      .populate({
        path: "patientRef",
        options: { strictPopulate: false },
        populate: {
          path: "linkedUserId",
          model: User,
          select:
            "firstNameEncrypted lastNameEncrypted bio gender dateOfBirth avatar",
          options: { strictPopulate: false },
        },
      })
      .populate(
        "files allergies familyHistoryOfDisease operations chronicDiseases immunization"
      )
      .lean();

    if (!history) {
      return res
        .status(404)
        .json({ success: false, message: "История болезни не найдена" });
    }

    /* ───── врач ───── */
    if (history.doctorId) {
      history.doctorId.firstName =
        history.doctorId.firstName ??
        safeDecrypt(history.doctorId.firstNameEncrypted) ??
        null;
      history.doctorId.lastName =
        history.doctorId.lastName ??
        safeDecrypt(history.doctorId.lastNameEncrypted) ??
        null;
    }
    if (history.createdBy) {
      history.createdBy.firstName =
        history.createdBy.firstName ??
        safeDecrypt(history.createdBy.firstNameEncrypted) ??
        null;
      history.createdBy.lastName =
        history.createdBy.lastName ??
        safeDecrypt(history.createdBy.lastNameEncrypted) ??
        null;
    }

    /* ───── пациент ───── */
    if (history.patientRef) {
      const p = history.patientRef;
      const u = p.linkedUserId || null;

      // 1. ИМЯ И ФАМИЛИЯ — пробуем расшифровать сначала из NewPatientPolyclinic,
      //    если там пусто — из связанного User.
      const firstFromPatient = safeDecrypt(p.firstNameEncrypted);
      const lastFromPatient = safeDecrypt(p.lastNameEncrypted);
      const firstFromUser = u ? safeDecrypt(u.firstNameEncrypted) : null;
      const lastFromUser = u ? safeDecrypt(u.lastNameEncrypted) : null;

      p.firstName = p.firstName || firstFromPatient || firstFromUser || null;
      p.lastName = p.lastName || lastFromPatient || lastFromUser || null;

      // 2. ПОЛ — из patient.bio/gender или User.bio/gender
      const rawGender = pickRawGender(p);
      p.gender = rawGender;
      p.genderRu = ruGender(rawGender);

      // 3. ДАТА РОЖДЕНИЯ — в NewPatientPolyclinic поле birthDate,
      //    в User — dateOfBirth. Берём первое доступное.
      p.birthDate = p.birthDate || u?.dateOfBirth || null;

      // 4. ФОТО
      p.photo = buildPhotoRelative(p, rawGender);

      // 5. Нормализуем массивы → строки (для удобства фронта)
      p.allergiesText = arrToStr(p.allergies ?? history.allergies);
      p.chronicDiseasesText = arrToStr(p.chronicDiseases ?? history.chronicDiseases);
      p.familyHistoryText = arrToStr(p.familyHistoryOfDisease ?? history.familyHistoryOfDisease);
      p.immunizationText = arrToStr(p.immunization ?? history.immunization);
      p.operationsText = arrToStr(p.operations ?? history.operations);

      // 6. Чистим зашифрованные поля из ответа (безопасность)
      delete p.firstNameEncrypted;
      delete p.lastNameEncrypted;
      delete p.emailEncrypted;
      delete p.phoneEncrypted;
      delete p.firstNameHash;
      delete p.lastNameHash;
      delete p.emailHash;
      delete p.phoneHash;
      if (u) {
        delete u.firstNameEncrypted;
        delete u.lastNameEncrypted;
        delete u.emailEncrypted;
        delete u.phoneEncrypted;
      }

      // 7. ✅ Дублируем под старым именем `patientId` для обратной совместимости с фронтом
      history.patientId = p;
    }

    return res.status(200).json({ success: true, data: history });
  } catch (error) {
    console.error("❌ Ошибка при получении детальной истории болезни:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении истории болезни",
    });
  }
};

export default getMyMedicalHistoryDetailsController;
