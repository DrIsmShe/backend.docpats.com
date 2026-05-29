import mongoose from "mongoose";
import NewPatientPolyclinicMedical from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

/**
 * UMR rewrite (Sprint 2 Phase 1):
 *
 *  Что изменилось:
 *   - Удалены legacy поля из payload:
 *       • patientId        — в схеме нет, Mongoose игнорировал, ломал админ-запросы
 *       • diagnosis        — удалено из схемы вместе с UMR, не пишем
 *       • isConsentGiven   — удалено, заменено моделью PatientConsent (Day 3)
 *   - status: "signed" пишется явно — старая семантика "сохраняю значит подписал".
 *     Когда фронт добавит drafts (Phase 2), будем брать из req.body.status.
 *   - signedAt + signedByUserId — обязательны для signed (UMR-валидатор)
 *
 *  Что НЕ изменилось:
 *   - createdBy: doctorUserId — продолжает работать для фрилансера
 *   - createdByEmployee / createdByClinicId — оставляем null
 *     (этот контроллер — myClinic flow, не clinic-medical)
 */

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

  /* ─────────────── 4) BODY ─────────────── */
  const {
    metaDescription,
    metaKeywords,
    readTime,
    complaints,
    anamnesisMorbi,
    anamnesisVitae,
    statusPreasens,
    statusLocalis,
    mainDiagnosis: rawMainDiagnosis,
    additionalDiagnosis,
    recommendations,
    ctScanResults,
    mriResults,
    ultrasoundResults,
    laboratoryTestResults,
  } = req.body ?? {};

  const trimOrNull = (v) => (typeof v === "string" ? v.trim() : (v ?? null));

  const patientTypeModel =
    patientType === "private" ? "DoctorPrivatePatient" : "NewPatientPolyclinic";

  /* ─── 4.1) Парсинг и валидация mainDiagnosis ─── */
  let mainDiagnosis = null;

  if (rawMainDiagnosis) {
    if (typeof rawMainDiagnosis === "string") {
      try {
        mainDiagnosis = JSON.parse(rawMainDiagnosis);
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: "Некорректный формат основного диагноза (mainDiagnosis).",
        });
      }
    } else if (typeof rawMainDiagnosis === "object") {
      mainDiagnosis = rawMainDiagnosis;
    }
  }

  if (
    !mainDiagnosis ||
    !mainDiagnosis.code?.toString().trim() ||
    !mainDiagnosis.text?.toString().trim()
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Основной диагноз обязателен: укажите код МКБ-10 и текст диагноза.",
    });
  }

  const cleanMainDiagnosis = {
    code: mainDiagnosis.code.toString().trim(),
    codeTitle: (mainDiagnosis.codeTitle || "").toString().trim(),
    text: mainDiagnosis.text.toString().trim(),
  };

  /* ─────────────── 5) PAYLOAD (UMR) ─────────────── */
  const now = new Date();

  const docPayload = {
    // Полиморфная связь с пациентом
    patientType,
    patientTypeModel,
    patientRef: patient._id,

    // UMR — авторство фрилансера
    doctorId: doctorUserId,
    createdBy: doctorUserId,
    createdByEmployee: null,
    createdByClinicId: null,

    // UMR — статус (для myClinic flow сразу signed)
    status: "signed",
    signedAt: now,
    signedByUserId: doctorUserId,
    signedByEmployeeId: null,

    // UMR — consent (per-record sharing пустой по умолчанию)
    sharedWith: [],

    // Содержимое
    metaDescription: trimOrNull(metaDescription),
    metaKeywords: trimOrNull(metaKeywords),
    readTime,

    complaints: trimOrNull(complaints),
    anamnesisMorbi: trimOrNull(anamnesisMorbi),
    anamnesisVitae: trimOrNull(anamnesisVitae),
    statusPreasens: trimOrNull(statusPreasens),
    statusLocalis: trimOrNull(statusLocalis),

    mainDiagnosis: cleanMainDiagnosis,

    additionalDiagnosis: trimOrNull(additionalDiagnosis),
    recommendations: trimOrNull(recommendations),

    ctScanResults: trimOrNull(ctScanResults),
    mriResults: trimOrNull(mriResults),
    ultrasoundResults: trimOrNull(ultrasoundResults),
    laboratoryTestResults: trimOrNull(laboratoryTestResults),
  };

  /* ─────────────── 6) SAVE ─────────────── */
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

    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    // Кастомные ошибки из pre('validate') хуков (UMR)
    if (
      err.message?.includes("Main diagnosis") ||
      err.message?.includes("Author is required") ||
      err.message?.includes("createdByClinicId is required") ||
      err.message?.includes("Signed/amended records require")
    ) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Ошибка при сохранении истории болезни.",
    });
  }
};

export default addPatientsPolyclinicMedicalHistoryController;
