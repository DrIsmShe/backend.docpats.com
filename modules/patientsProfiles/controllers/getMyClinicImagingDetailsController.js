// ✅ server/modules/patient-profile/controllers/getMyClinicImagingDetailsController.js
//
// Универсальный детальный просмотр клиничного снимка (ImagingStudy).
// Один endpoint на ВСЕ типы (КТ/МРТ/рентген/...), т.к. clinic-medical хранит
// их в одной модели ImagingStudy.
//
// Авторизация: снимок отдаётся только если его patientId (ClinicPatient)
// привязан к текущему пользователю (linkedUserId === userId). Чужие снимки → 403.
//
// Формат ответа совместим с детальной страницей: { ok: true, item }.

import mongoose from "mongoose";
import ImagingStudy from "../../../common/models/Polyclinic/MedicalHistory/ImagingStudy.js";
import ClinicPatient, {
  decryptValue,
} from "../../clinic/clinic-patients/models/clinicPatient.model.js";
import { decrypt } from "../../../common/models/Auth/users.js";

const STUDY_TYPE_LABEL = {
  CT: "КТ",
  MRI: "МРТ",
  USG: "УЗИ",
  "X-Ray": "Рентген",
  PET: "ПЭТ",
  SPECT: "ОФЭКТ",
  EEG: "ЭЭГ",
  ECG: "ЭКГ",
  Holter: "Холтер",
  Spirometry: "Спирометрия",
  Doppler: "Допплер",
  Gastroscopy: "Гастроскопия",
  Colonoscopy: "Колоноскопия",
  CapsuleEndoscopy: "Капсульная эндоскопия",
};

const safeDecryptUser = (v) => {
  if (!v) return null;
  try {
    return decrypt(v) || null;
  } catch {
    return null;
  }
};

// Автор снимка: User (фрилансер/врач с аккаунтом) → расшифровываем имя.
// Если автор — сотрудник клиники (createdByEmployee), имени нет → "Клиника".
const doctorFromStudy = (study) => {
  const u = study.createdBy; // populated User | null
  if (u && (u.firstNameEncrypted || u.lastNameEncrypted)) {
    return {
      _id: u._id || null,
      firstName: safeDecryptUser(u.firstNameEncrypted) || "?",
      lastName: safeDecryptUser(u.lastNameEncrypted) || "",
    };
  }
  return { _id: null, firstName: "Клиника", lastName: "" };
};

const getMyClinicImagingDetailsController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "Неверный формат ID" });
    }

    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Не авторизован" });
    }

    // ─── 1. Снимок ───
    const study = await ImagingStudy.findById(id)
      .populate({
        path: "createdBy",
        select: "firstNameEncrypted lastNameEncrypted",
        options: { strictPopulate: false },
      })
      .lean();

    if (!study) {
      return res.status(404).json({ ok: false, error: "Запись не найдена." });
    }

    // Этот endpoint только для clinic-снимков (привязка через patientId).
    if (!study.patientId) {
      return res.status(404).json({ ok: false, error: "Запись не найдена." });
    }

    // ─── 2. Авторизация: карта пациента принадлежит текущему юзеру ───
    const card = await ClinicPatient.findById(study.patientId)
      .setOptions({ skipTenantScope: true })
      .select(
        "_id linkedUserId firstNameEncrypted lastNameEncrypted dateOfBirth gender",
      )
      .lean();

    if (!card || String(card.linkedUserId || "") !== String(userId)) {
      return res.status(403).json({ ok: false, error: "Доступ запрещён." });
    }

    // ─── 3. Сборка ответа (форма для детальной страницы) ───
    const item = {
      _id: String(study._id),
      source: "clinic",
      studyType: study.studyType,
      studyTypeLabel: STUDY_TYPE_LABEL[study.studyType] || study.studyType,
      date: study.date || null,

      doctor: doctorFromStudy(study),
      patient: {
        firstName: decryptValue(card.firstNameEncrypted) || "",
        lastName: decryptValue(card.lastNameEncrypted) || "",
      },
      patientId: {
        dateOfBirth: card.dateOfBirth || null,
        gender: card.gender || null,
      },

      contrastUsed: Boolean(study.contrastUsed),

      nameofexam: STUDY_TYPE_LABEL[study.studyType] || study.studyType,
      diagnosis: study.diagnosis || "",
      recomandation: "",
      report: study.report || "",

      // снимки клиники → images[] (строки-URL); files[] — File-субдоки (обычно пуст)
      images: Array.isArray(study.images) ? study.images : [],
      files: Array.isArray(study.files) ? study.files : [],
      pacsLink: study.pacsLink || "",
      rawData: study.rawData || "",
      threeDModel: study.threeDModel || "",

      aiVersion: study.aiVersion || null,
      aiPrediction: study.aiPrediction || null,
      aiConfidence: study.aiConfidence ?? null,
      predictionConfidence: study.predictionConfidence ?? null,
      aiProcessingTime: study.aiProcessingTime ?? null,
      aiProcessedAt: study.aiProcessedAt || null,
      aiFindings: study.aiFindings ?? {},

      riskLevel: study.riskLevel || null,
      riskFactors: Array.isArray(study.riskFactors) ? study.riskFactors : [],
      validatedByDoctor: Boolean(study.validatedByDoctor),
      doctorNotes: study.doctorNotes || "",

      doctorComments: Array.isArray(study.doctorComments)
        ? study.doctorComments
        : [],

      createdAt: study.createdAt || null,
      updatedAt: study.updatedAt || null,
    };

    return res.status(200).json({ ok: true, item });
  } catch (error) {
    console.error("❌ getMyClinicImagingDetails error:", error);
    return res.status(500).json({ ok: false, error: "Ошибка сервера" });
  }
};

export default getMyClinicImagingDetailsController;
