// controllers/patient-profile/getMyMedicalHistoryDetailsController.js
import mongoose from "mongoose";
import newPatientMedicalHistoryModel from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import { canAccessPatientRecord } from "../utils/phiAccess.js";

// Sub-record models (patient-attribute records: chronic / allergies / etc.)
import ChronicDiseasesPatient from "../../../common/models/Polyclinic/MedicalHistory/chronicDiseasesPatient.js";
import AllergiesPatient from "../../../common/models/Polyclinic/MedicalHistory/allergiesPatient.js";
import FamilyHistoryOfDiseasePatient from "../../../common/models/Polyclinic/MedicalHistory/familyHistoryOfDiseasePatient.js";
import ImmunizationPatient from "../../../common/models/Polyclinic/MedicalHistory/immunizationPatient.js";

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
  const s = String(g || "")
    .trim()
    .toLowerCase();
  if (
    [
      "female",
      "f",
      "woman",
      "жен",
      "женщина",
      "ж",
      "qadin",
      "qadın",
      "kadın",
      "kadin",
    ].includes(s)
  )
    return "default/default-patient-woman.png";
  if (
    [
      "male",
      "m",
      "man",
      "м",
      "муж",
      "мужчина",
      "kişi",
      "kisi",
      "erkek",
    ].includes(s)
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
  const s = String(g || "")
    .trim()
    .toLowerCase();
  if (
    [
      "male",
      "m",
      "man",
      "м",
      "муж",
      "мужчина",
      "мужской",
      "kişi",
      "kisi",
      "erkek",
    ].includes(s)
  )
    return "Мужской";
  if (
    [
      "female",
      "f",
      "woman",
      "ж",
      "жен",
      "женщина",
      "женский",
      "qadin",
      "qadın",
      "kadin",
      "kadın",
    ].includes(s)
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
    p.linkedUserId?.gender,
    p.linkedUserId?.bio,
    p.userId?.gender,
    p.userId?.bio,
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
      .map((x) =>
        typeof x === "object" ? x?.name || x?.title || "" : String(x),
      )
      .filter(Boolean)
      .join(", ");
  }
  if (typeof v === "object") return v?.name || v?.title || "";
  return String(v);
};

/**
 * Собирает текст из sub-records (chronic/allergies/family/immunization).
 * Все они хранят содержимое в поле `content`. Привязка через `patientId`.
 * Это СВОИ данные пациента — берём всё по его картам, без clinic-фильтра.
 *
 * @param {mongoose.Model} Model
 * @param {ObjectId[]} patientIds  карты пациента (ClinicPatient + legacy)
 * @returns {Promise<string>}  склеенный текст или ""
 */
async function collectSubRecords(Model, patientIds) {
  if (!patientIds || patientIds.length === 0) return "";
  try {
    const docs = await Model.find({ patientId: { $in: patientIds } })
      .sort({ createdAt: -1 })
      .lean();
    return docs
      .map((d) => d.content || d.name || d.title || "")
      .filter(Boolean)
      .join(", ");
  } catch (e) {
    console.error(`collectSubRecords(${Model.modelName}) error:`, e.message);
    return "";
  }
}

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

    const history = await newPatientMedicalHistoryModel
      .findById(id)
      .populate({
        path: "createdBy",
        select: "firstNameEncrypted lastNameEncrypted",
        options: { strictPopulate: false },
      })
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
      .populate({
        path: "doctorProfileId",
        select: "position workplace educationInstitution profileImage",
        options: { strictPopulate: false },
      })
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
        "files allergies familyHistoryOfDisease operations chronicDiseases immunization",
      )
      .lean();

    if (!history) {
      return res
        .status(404)
        .json({ success: false, message: "История болезни не найдена" });
    }

    // 🔒 PHI-доступ: только владелец-пациент, врач-создатель или админ.
    if (!canAccessPatientRecord(req, history)) {
      return res
        .status(403)
        .json({ success: false, message: "Доступ запрещён" });
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

      const firstFromPatient = safeDecrypt(p.firstNameEncrypted);
      const lastFromPatient = safeDecrypt(p.lastNameEncrypted);
      const firstFromUser = u ? safeDecrypt(u.firstNameEncrypted) : null;
      const lastFromUser = u ? safeDecrypt(u.lastNameEncrypted) : null;

      p.firstName = p.firstName || firstFromPatient || firstFromUser || null;
      p.lastName = p.lastName || lastFromPatient || lastFromUser || null;

      const rawGender = pickRawGender(p);
      p.gender = rawGender;
      p.genderRu = ruGender(rawGender);

      p.birthDate = p.birthDate || p.dateOfBirth || u?.dateOfBirth || null;

      p.photo = buildPhotoRelative(p, rawGender);

      // ─── Демография из карты (если поля есть в ClinicPatient/Polyclinic) ───
      // citizenship / badHabits добавляются в ClinicPatient отдельным шагом.
      p.citizenship = p.citizenship || p.country || u?.country || "";
      p.badHabits = p.badHabits || "";

      // ─── Sub-records: собираем по ВСЕМ картам пациента ───
      // patientId в sub-records указывает на _id карты (ClinicPatient или
      // NewPatientPolyclinic). Берём _id текущей карты + (если linked) ищем
      // другие карты этого пользователя для полноты. Для одного encounter
      // достаточно текущей карты — она и есть владелец sub-records.
      const patientIds = [p._id].filter(Boolean);

      const [chronicTxt, allergyTxt, familyTxt, immunizTxt] = await Promise.all(
        [
          collectSubRecords(ChronicDiseasesPatient, patientIds),
          collectSubRecords(AllergiesPatient, patientIds),
          collectSubRecords(FamilyHistoryOfDiseasePatient, patientIds),
          collectSubRecords(ImmunizationPatient, patientIds),
        ],
      );

      // Собираем итоговый текст: сначала из encounter-populate (legacy
      // polyclinic — массивы-ссылки внутри энкаунтера), если пусто —
      // из отдельных clinic sub-records (привязка через patientId).
      const allergiesFinal =
        arrToStr(p.allergies ?? history.allergies) || allergyTxt;
      const chronicFinal =
        arrToStr(p.chronicDiseases ?? history.chronicDiseases) || chronicTxt;
      const familyFinal =
        arrToStr(p.familyHistoryOfDisease ?? history.familyHistoryOfDisease) ||
        familyTxt;
      const immunizFinal =
        arrToStr(p.immunization ?? history.immunization) || immunizTxt;
      const operationsFinal = arrToStr(p.operations ?? history.operations);

      // ВАЖНО: фронт (MyMedicalHistoryDetail.jsx) читает поля
      //   patient.allergies / .chronicDiseases / .familyHistoryOfDisease /
      //   .immunization  через toText(). Поэтому кладём итог именно туда
      //   (как строку — toText вернёт её как есть). Дублируем в *Text на
      //   случай, если фронт обновят на новые имена.
      p.allergies = allergiesFinal;
      p.chronicDiseases = chronicFinal;
      p.familyHistoryOfDisease = familyFinal;
      p.immunization = immunizFinal;
      p.operations = operationsFinal;

      p.allergiesText = allergiesFinal;
      p.chronicDiseasesText = chronicFinal;
      p.familyHistoryText = familyFinal;
      p.immunizationText = immunizFinal;
      p.operationsText = operationsFinal;

      // Чистим зашифрованные поля из ответа
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
