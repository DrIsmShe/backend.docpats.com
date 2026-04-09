import mongoose from "mongoose";
import NewPatientPolyclinicMedical from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

const addPatientsPolyclinicMedicalHistoryController = async (req, res) => {
  /* ─────────────── 1) AUTH ─────────────── */
  if (!req.session?.userId) {
    return res.status(403).json({
      success: false,
      message: "Пожалуйста, войдите в систему.",
    });
  }

  const doctorUserId = req.session.userId;

  /* ─────────────── 2) PATIENT (from resolvePatient) ─────────────── */
  const { patient, patientType } = req;

  if (!patient || !patientType) {
    return res.status(404).json({
      success: false,
      message: "Пациент не найден.",
    });
  }

  if (!mongoose.Types.ObjectId.isValid(patient._id)) {
    return res.status(400).json({
      success: false,
      message: "Некорректный ID пациента.",
    });
  }

  /* ─────────────── 3) OWNERSHIP CHECK ─────────────── */

  if (patientType === "private") {
    const checkPrivate = await DoctorPrivatePatient.findOne({
      _id: patient._id,
      doctorUserId: doctorUserId,
    }).select("_id");

    if (!checkPrivate) {
      return res.status(403).json({
        success: false,
        message: "Этот приватный пациент не принадлежит текущему врачу.",
      });
    }
  }

  if (patientType === "registered") {
    const checkRegistered = await NewPatientPolyclinic.findOne({
      _id: patient._id,
      doctorId: doctorUserId,
      isDeleted: false,
    }).select("_id");

    if (!checkRegistered) {
      return res.status(403).json({
        success: false,
        message: "Этот зарегистрированный пациент не связан с врачом.",
      });
    }
  }

  /* ─────────────── 4) STABLE patientId ─────────────── */
  const patientId =
    patient.patientId?.toString?.() || patient._id?.toString?.();

  if (!patientId) {
    console.error("[MedicalHistory] patientId resolve failed", {
      patientType,
      patient,
    });

    return res.status(400).json({
      success: false,
      message: "Не удалось определить patientId.",
    });
  }

  /* ─────────────── 5) BODY ─────────────── */
  const {
    metaDescription,
    metaKeywords,
    readTime,
    complaints,
    anamnesisMorbi,
    anamnesisVitae,
    statusPreasens,
    statusLocalis,
    diagnosis,
    additionalDiagnosis,
    recommendations,
    ctScanResults,
    mriResults,
    ultrasoundResults,
    laboratoryTestResults,
    isConsentGiven,
  } = req.body ?? {};

  const trimOrNull = (v) => (typeof v === "string" ? v.trim() : (v ?? null));

  const patientTypeModel =
    patientType === "private" ? "DoctorPrivatePatient" : "NewPatientPolyclinic";

  /* ─────────────── 6) PAYLOAD ─────────────── */
  const docPayload = {
    patientId,
    patientType,
    patientTypeModel,
    patientRef: patient._id,
    doctorId: doctorUserId,
    createdBy: doctorUserId,

    metaDescription: trimOrNull(metaDescription),
    metaKeywords: trimOrNull(metaKeywords),
    readTime,

    complaints: trimOrNull(complaints),
    anamnesisMorbi: trimOrNull(anamnesisMorbi),
    anamnesisVitae: trimOrNull(anamnesisVitae),
    statusPreasens: trimOrNull(statusPreasens),
    statusLocalis: trimOrNull(statusLocalis),

    diagnosis: trimOrNull(diagnosis),
    additionalDiagnosis: trimOrNull(additionalDiagnosis),
    recommendations: trimOrNull(recommendations),

    ctScanResults: trimOrNull(ctScanResults),
    mriResults: trimOrNull(mriResults),
    ultrasoundResults: trimOrNull(ultrasoundResults),
    laboratoryTestResults: trimOrNull(laboratoryTestResults),

    isConsentGiven: !!isConsentGiven,
  };

  /* ─────────────── 7) SAVE ─────────────── */
  try {
    const history = new NewPatientPolyclinicMedical(docPayload);
    await history.save();

    return res.status(201).json({
      success: true,
      message: "История болезни успешно добавлена!",
      medicalHistory: history,
    });
  } catch (err) {
    console.error("[MedicalHistory] Ошибка сохранения:", err);

    return res.status(500).json({
      success: false,
      message: "Ошибка при сохранении истории болезни.",
    });
  }
};

export default addPatientsPolyclinicMedicalHistoryController;
