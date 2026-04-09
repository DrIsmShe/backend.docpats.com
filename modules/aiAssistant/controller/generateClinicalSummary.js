import Patient from "../../../common/models/PatientProfile/patientProfile.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import { generateSummary } from "../service/generateSummary.js";

/* ===== HISTORY MODELS ===== */
import NewPatientMedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";

/* ===== EXAM MODELS ===== */
import Angiographyscan from "../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/Angiographyscan.js";
import CTScan from "../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScan.js";
import CapsuleEndoscopyScan from "../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScan.js";
import Coronographyscan from "../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/Coronographyscan.js";
import DoplerScan from "../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScan.js";
import EEGScan from "../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScan.js";
import EKGscan from "../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGscan.js";
import EchoEKGscan from "../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGscan.js";
import GastroscopyScan from "../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScan.js";
import Ginecology from "../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/Ginecology.js";
import HOLTERscan from "../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERscan.js";
import LabTest from "../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";
import MRIScan from "../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScan.js";
import PETScan from "../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScan.js";
import SPECTScan from "../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScan.js";
import SpirometryScan from "../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScan.js";
import USMscan from "../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMscan.js";
import XRayScan from "../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScan.js";

const generateClinicalSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const { language } = req.body;

    /* =========================
       1️⃣ AUTH
    ========================== */
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const doctorProfile = await ProfileDoctor.findOne({
      userId: req.user._id,
    });

    if (!doctorProfile || doctorProfile.verificationStatus !== "approved") {
      return res.status(403).json({
        message: "AI access available only for verified doctors",
      });
    }

    /* =========================
       2️⃣ UNIVERSAL PATIENT SEARCH
    ========================== */

    let patientCore = null;
    let patientFilter = null;
    let polyPatient = null;
    let privatePatient = null;

    // 1️⃣ Новый пациент поликлиники
    polyPatient = await NewPatientPolyclinic.findById(id);

    if (polyPatient) {
      if (polyPatient.patientType === "registered") {
        // зарегистрированный пациент поликлиники
        patientCore = polyPatient;
        patientFilter = { registeredPatient: polyPatient.registeredPatient };
      } else {
        // приватный пациент, к которому привязан NewPatientPolyclinic
        patientCore = polyPatient;
        patientFilter = {
          patient: polyPatient._id,
          patientModel: "NewPatientPolyclinic",
        };
      }
    } else {
      // 2️⃣ Прямо DoctorPrivatePatient (страница PrivatePatientDetail)
      privatePatient = await DoctorPrivatePatient.findById(id);

      if (privatePatient) {
        patientCore = privatePatient;
        // все обследования, где указан этот privatePatient
        patientFilter = {
          patient: privatePatient._id,
          patientModel: "DoctorPrivatePatient",
        };
      } else {
        // 3️⃣ Старый PatientProfile fallback
        const legacyPatient = await Patient.findById(id);
        if (legacyPatient) {
          patientCore = legacyPatient;
          patientFilter = { patient: legacyPatient._id };
        }
      }
    }

    if (!patientCore) {
      return res.status(404).json({ message: "Patient not found" });
    }

    const findScans = (Model) =>
      Model.find(patientFilter).sort({ createdAt: -1 });

    /* =========================
       3️⃣ LOAD ALL EXAMS
    ========================== */

    const [
      ctScans,
      mriScans,
      usmScans,
      xrayScans,
      petScans,
      spectScans,
      eegScans,
      ginecologyScans,
      holterScans,
      spirometryScans,
      doplerScans,
      gastroscopyScans,
      capsuleEndoscopyScans,
      angiographyScans,
      ekgScans,
      echoEkgScans,
      coronographyScans,
      labTests,
    ] = await Promise.all([
      findScans(CTScan),
      findScans(MRIScan),
      findScans(USMscan),
      findScans(XRayScan),
      findScans(PETScan),
      findScans(SPECTScan),
      findScans(EEGScan),
      findScans(Ginecology),
      findScans(HOLTERscan),
      findScans(SpirometryScan),
      findScans(DoplerScan),
      findScans(GastroscopyScan),
      findScans(CapsuleEndoscopyScan),
      findScans(Angiographyscan),
      findScans(EKGscan),
      findScans(EchoEKGscan),
      findScans(Coronographyscan),
      findScans(LabTest),
    ]);

    /* =========================
       4️⃣ LOAD MEDICAL HISTORY
    ========================== */

    let medicalHistories = [];

    if (polyPatient) {
      // Истории болезни, привязанные к NewPatientPolyclinic
      medicalHistories = await NewPatientMedicalHistory.find({
        patientTypeModel: "NewPatientPolyclinic",
        patientRef: polyPatient._id,
      }).sort({ createdAt: -1 });
    } else if (privatePatient) {
      // 🔥 Истории болезни по приватному пациенту (УТОЧНИ имя patientTypeModel, если другое)
      medicalHistories = await NewPatientMedicalHistory.find({
        patientTypeModel: "DoctorPrivatePatient",
        patientRef: privatePatient._id,
      }).sort({ createdAt: -1 });
    }

    const medicalHistoryRecords = medicalHistories.map((h) => ({
      id: h._id.toString(),
      createdAt: h.createdAt,
      complaints: h.complaints,
      anamnesisMorbi: h.anamnesisMorbi,
      anamnesisVitae: h.anamnesisVitae,
      statusPreasens: h.statusPreasens,
      statusLocalis: h.statusLocalis,
      recommendations: h.recommendations,
      diagnosis: h.diagnosis,
      additionalDiagnosis: h.additionalDiagnosis,
      ctScanResults: h.ctScanResults,
      mriResults: h.mriResults,
      ultrasoundResults: h.ultrasoundResults,
      laboratoryTestResults: h.laboratoryTestResults,
    }));

    /* =========================
       5️⃣ CHECK CLINICAL DATA
    ========================== */

    const hasClinicalData = [
      ctScans,
      mriScans,
      usmScans,
      xrayScans,
      petScans,
      spectScans,
      eegScans,
      ginecologyScans,
      holterScans,
      spirometryScans,
      doplerScans,
      gastroscopyScans,
      capsuleEndoscopyScans,
      angiographyScans,
      ekgScans,
      echoEkgScans,
      coronographyScans,
      labTests,
      medicalHistories,
    ].some((arr) => arr && arr.length > 0);

    if (!hasClinicalData) {
      return res.status(400).json({
        message: "Not enough clinical data to generate summary",
      });
    }
    /* =========================
   6️⃣ BUILD DATA FOR AI (SAFE & COMPACT)
========================== */

    // ... твой код с core, compactScans, compactLabs, compactHistory и patientDataForAI

    /* =========================
   7️⃣ BUILD DIAGNOSTIC INVENTORY
========================== */

    const diagnosticInventory = {
      total:
        ctScans.length +
        mriScans.length +
        usmScans.length +
        xrayScans.length +
        petScans.length +
        spectScans.length +
        eegScans.length +
        ginecologyScans.length +
        holterScans.length +
        spirometryScans.length +
        doplerScans.length +
        gastroscopyScans.length +
        capsuleEndoscopyScans.length +
        angiographyScans.length +
        ekgScans.length +
        echoEkgScans.length +
        coronographyScans.length +
        labTests.length,

      modalities: {
        ct: ctScans.length,
        mri: mriScans.length,
        usm: usmScans.length,
        xray: xrayScans.length,
        pet: petScans.length,
        spect: spectScans.length,

        eeg: eegScans.length,
        ekg: ekgScans.length,
        echoEkg: echoEkgScans.length,
        holter: holterScans.length,
        spirometry: spirometryScans.length,
        dopler: doplerScans.length,

        gastroscopy: gastroscopyScans.length,
        capsuleEndoscopy: capsuleEndoscopyScans.length,
        ginecology: ginecologyScans.length,

        angiography: angiographyScans.length,
        coronography: coronographyScans.length,

        labTests: labTests.length,
      },
    };
    /* =========================
       6️⃣ BUILD DATA FOR AI
    ========================== */

    /* =========================
   6️⃣ BUILD DATA FOR AI (SAFE & COMPACT)
========================== */

    const core = patientCore.toObject();

    /* 🔹 Универсальная функция очистки обследований */
    const compactScans = (arr = []) =>
      arr.map((s) => ({
        id: s._id?.toString() || null,
        date: s.date || s.createdAt || null,
        examName: s.nameofexam || s.testType || null,
        diagnosis: s.diagnosis || null,
        additionalDiagnosis: s.additionalDiagnosis || null,
        report: s.report || null,
        conclusion: s.conclusion || null,
      }));

    /* 🔹 Компактная версия лаборатории */
    const compactLabs = (arr = []) =>
      arr.map((l) => ({
        id: l._id?.toString() || null,
        date: l.date || l.createdAt || null,
        testType: l.testType || null,
        labName: l.labName || null,
        report: l.report || null,
        diagnosis: l.diagnosis || null,
      }));

    /* 🔹 Компактная история болезни */
    const compactHistory = medicalHistoryRecords.map((h) => ({
      id: h.id,
      createdAt: h.createdAt,
      complaints: h.complaints || null,
      anamnesisMorbi: h.anamnesisMorbi || null,
      anamnesisVitae: h.anamnesisVitae || null,
      statusPreasens: h.statusPreasens || null,
      statusLocalis: h.statusLocalis || null,
      diagnosis: h.diagnosis || null,
      additionalDiagnosis: h.additionalDiagnosis || null,
      recommendations: h.recommendations || null,
    }));

    /* 🔹 Финальная структура для AI */
    const patientDataForAI = {
      patientId: patientCore._id.toString(), // ← добавить первой строкой
      birthDate: core.birthDate || null,
      gender: core.gender || null,

      chronicDiseases: core.chronicDiseases || [],
      allergies: core.allergies || [],
      badHabits: core.badHabits || [],

      legacyMedicalHistory: core.medicalHistory || null,

      medicalHistoryRecords: compactHistory,

      /* RADIOLOGY */
      ctScans: compactScans(ctScans),
      mriScans: compactScans(mriScans),
      usmScans: compactScans(usmScans),
      xrayScans: compactScans(xrayScans),
      petScans: compactScans(petScans),
      spectScans: compactScans(spectScans),

      /* FUNCTIONAL */
      eegScans: compactScans(eegScans),
      ekgScans: compactScans(ekgScans),
      echoEkgScans: compactScans(echoEkgScans),
      holterScans: compactScans(holterScans),
      spirometryScans: compactScans(spirometryScans),
      doplerScans: compactScans(doplerScans),

      /* ENDOSCOPY / GYN */
      gastroscopyScans: compactScans(gastroscopyScans),
      capsuleEndoscopyScans: compactScans(capsuleEndoscopyScans),
      ginecologyScans: compactScans(ginecologyScans),

      /* ANGIO */
      angiographyScans: compactScans(angiographyScans),
      coronographyScans: compactScans(coronographyScans),

      /* LAB */
      labTests: compactLabs(labTests),
    };
    /* =========================
       7️⃣ META FOR FRONT
    ========================== */

    const meta = {
      examinations: {
        ct: ctScans.length,
        mri: mriScans.length,
        usm: usmScans.length,
        xray: xrayScans.length,
        pet: petScans.length,
        spect: spectScans.length,
        eeg: eegScans.length,
        ginecology: ginecologyScans.length,
        holter: holterScans.length,
        spirometry: spirometryScans.length,
        dopler: doplerScans.length,
        gastroscopy: gastroscopyScans.length,
        capsuleEndoscopy: capsuleEndoscopyScans.length,
        angiography: angiographyScans.length,
        ekg: ekgScans.length,
        echoEkg: echoEkgScans.length,
        coronography: coronographyScans.length,
        labTests: labTests.length,
      },
      sources: {
        hasMedicalHistoryRecords: medicalHistories.length > 0,
        hasLegacyMedicalHistory: !!core.medicalHistory,
        hasChronicDiseases: !!core.chronicDiseases?.length,
        hasAllergies: !!core.allergies?.length,
        hasBadHabits: !!core.badHabits?.length,
      },
    };

    /* =========================
       8️⃣ CALL AI
    ========================== */

    const summary = await generateSummary(patientDataForAI, language);

    return res.json({
      summary,
      meta,
      diagnosticInventory,
    });
  } catch (error) {
    console.error("AI summary error:", error);
    return res.status(500).json({ message: "AI summary failed" });
  }
};

export default generateClinicalSummary;
