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

/** Берём пол из любых разумных ключей, включая User.bio */
const pickRawGender = (p = {}) => {
  const candidates = [
    p.gender,
    p.bio,
    p.BIO,
    // если популятили userId → это User-документ
    p.userId?.gender,
    p.userId?.bio,
    // иногда поле может называться иначе
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
      // пациент (из поликлиники) + вложенно попытаться подтянуть связанного User
      .populate({
        path: "patientId",
        options: { strictPopulate: false },
        populate: [
          // если в схеме NewPatientPolyclinic есть связь userId → User
          {
            path: "userId",
            model: User, // важен сам класс модели, а не строка, чтобы не было "Use mongoose.model(name, schema)"
            select: "bio gender",
            options: { strictPopulate: false },
          },
        ],
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

    // --- врач ---
    if (history.doctorId) {
      history.doctorId.firstName =
        history.doctorId.firstName ??
        decrypt(history.doctorId.firstNameEncrypted) ??
        null;
      history.doctorId.lastName =
        history.doctorId.lastName ??
        decrypt(history.doctorId.lastNameEncrypted) ??
        null;
    }
    if (history.createdBy) {
      history.createdBy.firstName =
        history.createdBy.firstName ??
        decrypt(history.createdBy.firstNameEncrypted) ??
        null;
      history.createdBy.lastName =
        history.createdBy.lastName ??
        decrypt(history.createdBy.lastNameEncrypted) ??
        null;
    }

    // --- пациент ---
    if (history.patientId) {
      const p = history.patientId;

      // имя/фамилия (если у поликлинической карточки есть зашифрованные)
      history.patientId.firstName =
        p.firstName ?? decrypt(p.firstNameEncrypted) ?? null;
      history.patientId.lastName =
        p.lastName ?? decrypt(p.lastNameEncrypted) ?? null;

      // ключевая строка: берём пол из gender/bio/BIO или из связанного User (userId.bio / userId.gender)
      const rawGender = pickRawGender(p);
      history.patientId.gender = rawGender;
      history.patientId.genderRu = ruGender(rawGender);

      // фото
      history.patientId.photo = buildPhotoRelative(p, rawGender);
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
