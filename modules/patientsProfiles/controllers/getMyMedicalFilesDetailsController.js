// ✅ server/modules/patient-profile/controllers/getMyMedicalFilesDetailsController.js

import mongoose from "mongoose";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

/* ===============================
   📦 Подгружаем все модели
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
   📚 Все модели
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

    const userId = new mongoose.Types.ObjectId(patientId);

    /* ============================================
       🔥 НАХОДИМ ТОЛЬКО зарегистрированный профиль
    ============================================ */

    const profile = await NewPatientPolyclinic.findOne({
      $or: [
        { linkedUserId: userId },
        { registeredPatient: userId },
        { _id: userId }, // если вдруг передали profileId
      ],
    }).select("_id");

    if (!profile) {
      return res.status(404).json({
        message: "Registered patient profile not found",
      });
    }

    const profileId = profile._id;

    /* ============================================
       📚 Какие модели искать
    ============================================ */

    const modelsToSearch = studyType
      ? { [studyType]: studyModels[studyType] }
      : studyModels;

    const results = [];

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

    /* ============================================
       📊 Финальная сортировка
    ============================================ */

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
