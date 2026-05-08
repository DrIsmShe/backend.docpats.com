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
    mainDiagnosis: rawMainDiagnosis, // ← НОВОЕ: приходит как JSON-строка
    diagnosis, // ← старое поле, оставлено для обратной совместимости
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

  /* ─── 5.1) Парсинг и валидация mainDiagnosis ─── */
  // FormData не умеет передавать вложенные объекты, поэтому фронт шлёт JSON-строкой.
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
      // На случай, если придёт уже как объект (например, JSON-запрос вместо FormData)
      mainDiagnosis = rawMainDiagnosis;
    }
  }

  // Проверяем обязательные поля диагноза
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

  // Чистим перед сохранением
  const cleanMainDiagnosis = {
    code: mainDiagnosis.code.toString().trim(),
    codeTitle: (mainDiagnosis.codeTitle || "").toString().trim(),
    text: mainDiagnosis.text.toString().trim(),
  };

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

    // ─── Новый структурированный диагноз ───
    mainDiagnosis: cleanMainDiagnosis,

    // ─── Старое поле — заполняем из text для обратной совместимости ───
    // Это нужно, чтобы старые места кода, которые читают `diagnosis`
    // (списки, экспорт, отчёты), продолжали работать без изменений.
    diagnosis: cleanMainDiagnosis.text,

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

    // Mongoose ValidationError → 400, читаемое сообщение
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    // Кастомная ошибка из pre('validate') хука
    if (err.message?.includes("Main diagnosis")) {
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
