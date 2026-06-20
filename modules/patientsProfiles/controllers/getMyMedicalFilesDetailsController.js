// ✅ server/modules/patient-profile/controllers/getMyMedicalFilesDetailsController.js
//
// ─────────────────────────────────────────────────────────────────────────────
//  FIX (3 Jun 2026): теперь список тянет файлы из ДВУХ систем:
//    1. Старые scan-модели (CTScan/MRIScan/...) — привязка к NewPatientPolyclinic
//    2. ImagingStudy (clinic-medical) — привязка к ClinicPatient.patientId
//
//  Раньше контроллер смотрел только в старые модели и возвращал 404, если у
//  пациента не было polyclinic-профиля. Поэтому снимки, загруженные клиникой
//  (ImagingStudy + ClinicPatient), были невидимы. Теперь:
//    - polyclinic-профиль НЕОБЯЗАТЕЛЕН (нет → просто пропускаем старый блок);
//    - clinic-карты резолвятся по ClinicPatient.linkedUserId (skipTenantScope);
//    - ImagingStudy ищется по patientId ∈ [clinic-карты];
//    - типы клиники маппятся в имена, которые понимает фронт (MRI→MRIScan ...).
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

// Новые источники (clinic-medical)
import ClinicPatient from "../../clinic/clinic-patients/models/clinicPatient.model.js";
import ImagingStudy from "../../../common/models/Polyclinic/MedicalHistory/ImagingStudy.js";
import { decrypt } from "../../../common/models/Auth/users.js";

/* ===============================
   📦 Подгружаем все старые модели
================================ */
import "../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMscan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/Ginecology.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERscan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/Angiographyscan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGscan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGscan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/Coronographyscan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";

/* ===============================
   📚 Старые модели
================================ */
const studyModels = {
  CTScan: mongoose.models.CTScan,
  MRIScan: mongoose.models.MRIScan,
  USMScan: mongoose.models.USMScan,
  XRayScan: mongoose.models.XRayScan,
  PETScan: mongoose.models.PETScan,
  SPECTScan: mongoose.models.SPECTScan,
  EEGScan: mongoose.models.EEGScan,
  EKGScan: mongoose.models.EKGScan,
  HOLTERScan: mongoose.models.HOLTERScan,
  SpirometryScan: mongoose.models.SpirometryScan,
  DoplerScan: mongoose.models.DoplerScan,
  GastroscopyScan: mongoose.models.GastroscopyScan,
  CapsuleEndoscopyScan: mongoose.models.CapsuleEndoscopyScan,
  AngiographyScan: mongoose.models.AngiographyScan,
  CoronographyScan: mongoose.models.CoronographyScan,
  EchoEKGScan: mongoose.models.EchoEKGScan,
  GinecologyScan: mongoose.models.GinecologyScan,
  LabTest: mongoose.models.LabTest,
};

/* ===============================
   🔁 Маппинг типов: клиника ↔ фронт
================================ */

// ImagingStudy.studyType (enum клиники) → имя типа, которое понимает фронт.
// Фронт нормализует через toLowerCase и ищет в TYPE_META — поэтому отдаём
// "старые" имена (MRIScan и т.п.).
const CLINIC_TO_FRONT_TYPE = {
  CT: "CTScan",
  MRI: "MRIScan",
  USG: "USMScan",
  "X-Ray": "XRayScan",
  PET: "PETScan",
  SPECT: "SPECTScan",
  EEG: "EEGScan",
  ECG: "EKGScan",
  Holter: "HOLTERScan",
  Spirometry: "SpirometryScan",
  Doppler: "DoplerScan",
  Gastroscopy: "GastroscopyScan",
  CapsuleEndoscopy: "CapsuleEndoscopyScan",
  Colonoscopy: "Colonoscopy", // нет фронт-аналога → дефолтная иконка
};

// Обратный маппинг для фильтра из дропдауна (фронт шлёт "MRIScan" → ищем "MRI")
const FRONT_TO_CLINIC_TYPE = Object.fromEntries(
  Object.entries(CLINIC_TO_FRONT_TYPE).map(([clinic, front]) => [
    front,
    clinic,
  ]),
);

/* ===============================
   🔧 Утилиты
================================ */

const normalizeDoctor = (doctor) => {
  if (!doctor) return { _id: null, firstName: "?", lastName: "?" };

  if (typeof doctor.decryptFields === "function") {
    const d = doctor.decryptFields();
    return {
      _id: doctor._id,
      firstName: d?.firstName || "?",
      lastName: d?.lastName || "?",
    };
  }

  return {
    _id: doctor._id,
    firstName: doctor.firstName || "?",
    lastName: doctor.lastName || "?",
  };
};

const resolveDateField = (Model) => {
  if (Model.schema.path("createdAt")) return "createdAt";
  if (Model.schema.path("date")) return "date";
  return null;
};

const safeDecrypt = (val) => {
  if (!val) return null;
  try {
    return decrypt(val) || null;
  } catch {
    return null;
  }
};

/**
 * Достаём «врача» (автора) из ImagingStudy.
 * createdBy (User) → расшифровываем имя. Если автор — сотрудник клиники
 * (createdByEmployee), имени под рукой нет → показываем "Клиника".
 */
const doctorFromImaging = (study) => {
  const u = study.createdBy; // populated User | null
  if (u && (u.firstNameEncrypted || u.lastNameEncrypted)) {
    return {
      _id: u._id || null,
      firstName: safeDecrypt(u.firstNameEncrypted) || "?",
      lastName: safeDecrypt(u.lastNameEncrypted) || "",
    };
  }
  return { _id: null, firstName: "Клиника", lastName: "" };
};

/* ===============================
   📋 Контроллер
================================ */

const getMyMedicalFilesDetailsController = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { studyType, startDate, endDate } = req.query;

    if (!mongoose.Types.ObjectId.isValid(patientId)) {
      return res.status(400).json({ message: "Invalid patientId format" });
    }

    // 🔒 IDOR-guard: пациент видит только свои файлы. Срабатывает ТОЛЬКО для
    // пациента, запросившего чужой id; для self / врача / staff — пропускает.
    // Если auth-middleware не кладёт req.user — проверка просто пропускается
    // (поведение не меняется). Можно убрать, если мешает.
    if (
      req.user?.userId &&
      req.user.role === "patient" &&
      String(req.user.userId) !== String(patientId)
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    const userId = new mongoose.Types.ObjectId(patientId);
    const results = [];

    /* ============================================================
       1️⃣  СТАРАЯ СИСТЕМА — scan-модели по polyclinic-профилю
       (теперь НЕОБЯЗАТЕЛЬНА: нет профиля → просто пропускаем блок)
    ============================================================ */

    const profile = await NewPatientPolyclinic.findOne({
      $or: [
        { linkedUserId: userId },
        { registeredPatient: userId },
        { _id: userId }, // если вдруг передали profileId
      ],
    })
      .select("_id")
      .lean();

    if (profile) {
      const profileId = profile._id;

      const modelsToSearch = studyType
        ? { [studyType]: studyModels[studyType] }
        : studyModels;

      for (const [modelName, Model] of Object.entries(modelsToSearch)) {
        if (!Model) continue;

        const orConditions = [];

        if (Model.schema.path("patient")) {
          const patientFilter = { patient: profileId };
          if (Model.schema.path("patientModel")) {
            patientFilter.patientModel = "NewPatientPolyclinic";
          }
          orConditions.push(patientFilter);
        }
        if (Model.schema.path("patientId")) {
          orConditions.push({ patientId: profileId });
        }
        if (!orConditions.length) continue;

        const filter = { $or: orConditions };
        const dateField = resolveDateField(Model);

        if (dateField && (startDate || endDate)) {
          filter[dateField] = {};
          if (startDate) filter[dateField].$gte = new Date(startDate);
          if (endDate) filter[dateField].$lte = new Date(endDate);
        }

        const sort = dateField ? { [dateField]: -1 } : { _id: -1 };

        const scans = await Model.find(filter)
          .populate("doctor")
          .sort(sort)
          .lean();

        for (const scan of scans) {
          results.push({
            _id: scan._id,
            type: modelName,
            source: "legacy",
            nameofexam: scan.nameofexam || "",
            diagnosis: scan.diagnosis || "",
            report: scan.report || "",
            recomandation: scan.recomandation || "",
            createdAt: scan.createdAt || scan.date || null,
            doctor: normalizeDoctor(scan.doctor),
            files: Array.isArray(scan.files) ? scan.files : [],
          });
        }
      }
    }

    /* ============================================================
       2️⃣  НОВАЯ СИСТЕМА — ImagingStudy (clinic-medical)
       Резолвим карты пациента в клиниках → ищем снимки по patientId.
    ============================================================ */

    // Карты пациента во всех клиниках (tenantScoped → bypass для patient-side)
    const clinicCards = await ClinicPatient.find({ linkedUserId: userId })
      .setOptions({ skipTenantScope: true })
      .select("_id")
      .lean();

    const clinicCardIds = clinicCards.map((c) => c._id);

    if (clinicCardIds.length > 0) {
      const imagingFilter = { patientId: { $in: clinicCardIds } };

      // Фильтр по типу из дропдауна: фронт шлёт "MRIScan" → клиничный "MRI".
      // Если выбранный тип не имеет клиничного аналога (напр. LabTest,
      // Ginecology) — clinic-блок просто не даст совпадений.
      if (studyType) {
        const clinicType = FRONT_TO_CLINIC_TYPE[studyType];
        if (!clinicType) {
          // нет клиничного аналога → пропускаем ImagingStudy целиком
          imagingFilter.studyType = "__none__";
        } else {
          imagingFilter.studyType = clinicType;
        }
      }

      // Фильтр по дате — по полю date (дата исследования).
      if (startDate || endDate) {
        imagingFilter.date = {};
        if (startDate) imagingFilter.date.$gte = new Date(startDate);
        if (endDate) imagingFilter.date.$lte = new Date(endDate);
      }

      const studies = await ImagingStudy.find(imagingFilter)
        .populate({
          path: "createdBy",
          select: "firstNameEncrypted lastNameEncrypted",
          options: { strictPopulate: false },
        })
        .sort({ date: -1, createdAt: -1 })
        .lean();

      for (const study of studies) {
        const frontType =
          CLINIC_TO_FRONT_TYPE[study.studyType] || study.studyType;
        results.push({
          _id: study._id,
          type: frontType,
          source: "clinic", // ← маркер для детальной страницы (File 2)
          nameofexam: study.diagnosis || "",
          diagnosis: study.diagnosis || "",
          report: study.report || "",
          recomandation: "",
          createdAt: study.date || study.createdAt || null,
          doctor: doctorFromImaging(study),
          // снимки клиники лежат в images[] (строки-URL); files[] обычно пуст
          images: Array.isArray(study.images) ? study.images : [],
          files: Array.isArray(study.files) ? study.files : [],
          validatedByDoctor: Boolean(study.validatedByDoctor),
        });
      }
    }

    /* ============================================================
       📊 Финальная сортировка по дате
    ============================================================ */

    results.sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    );

    return res.status(200).json(results);
  } catch (error) {
    console.error("❌ getMyMedicalFilesDetails error:", error);
    return res.status(500).json({
      message: "Server error while fetching medical files",
    });
  }
};

export default getMyMedicalFilesDetailsController;
