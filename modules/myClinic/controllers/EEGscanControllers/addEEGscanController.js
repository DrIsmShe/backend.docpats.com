import mongoose from "mongoose";
import EEGScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScan.js";
import File from "../../../../common/models/file.js";
import User from "../../../../common/models/Auth/users.js";
import AuditLog from "../../../../common/models/auditLog.js";
import { invalidatePatientAISummary } from "../../../aiAssistant/service/aiAutoRefreshService.js";

/* ============= MIME → fileType helper ============= */
function resolveFileType(mimetype) {
  if (!mimetype) return "other";
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  if (mimetype === "application/pdf") return "pdf";
  if (
    mimetype === "application/msword" ||
    mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "document";
  }
  return "other";
}

/* ============= Constants ============= */

const PRIVATE_PATIENT_MODELS = ["DoctorPrivatePatient"];

/* ============= Controller ============= */

const addEEGscanController = async (req, res) => {
  try {
    /* -------- AUTH -------- */
    const doctorId = req.session?.userId;
    const { patient } = req; // 👈 resolvePatient middleware кладёт сюда пациента

    if (!doctorId) {
      return res.status(401).json({ message: "⛔You are not logged in" });
    }

    if (!patient) {
      return res.status(404).json({ message: "❌ Patient not found" });
    }

    /* -------- DOCTOR -------- */
    const doctor = await User.findById(doctorId).populate("specialization");
    if (!doctor) {
      return res.status(404).json({ message: "❌ User not found" });
    }

    const specializationName = doctor.specialization?.name; // оставляю, как в твоём коде
    const allowedSpecializations = [
      "Neurologist",
      "Pediatric Neurologist",
      "Functional Diagnostics Specialist",
      "Radiologist",
    ];

    /* -------- PATIENT MODEL / PRIVATE vs REGISTERED -------- */
    const patientModelName = patient.constructor?.modelName;
    const isPrivatePatient = PRIVATE_PATIENT_MODELS.includes(patientModelName);
    const doctorSpecName = doctor.specialization?.name || null;

    let performedOutsideSpecialization = false;

    // 🔒 Registered → строгий контроль
    if (!isPrivatePatient) {
      if (!doctorSpecName || !allowedSpecializations.includes(doctorSpecName)) {
        return res.status(403).json({
          messageKey: "errors.insufficientRightsRegisteredPatient",
        });
      }
    } else {
      // 🔓 Private → разрешаем, но фиксируем флагом
      if (!doctorSpecName || !allowedSpecializations.includes(doctorSpecName)) {
        performedOutsideSpecialization = true;
      }
    }

    /* -------- BODY -------- */
    const {
      nameofexam,
      diagnosis,
      report,
      radiationDose,
      contrastUsed,
      previousStudy,
      relatedStudies,
      aiFindings,
      aiConfidence,
      aiVersion,
      aiPrediction,
      predictionConfidence,
      aiProcessingTime,
      validatedByDoctor,
      doctorNotes,
      threeDModel,
      imageQuality,
      needsRetake,
      riskLevel,
      riskFactors,
      recomandation,
    } = req.body;

    /* -------- FILES -------- */
    let uploadedFiles = [];

    if (Array.isArray(req.uploadedFiles) && req.uploadedFiles.length > 0) {
      uploadedFiles = req.uploadedFiles.map((file) => ({
        fileName: file.fileName,
        fileUrl: file.fileUrl,
        fileFormat: file.fileFormat,
        fileSize: file.fileSize,
        fileType: resolveFileType(file.fileFormat),
        studyTypeReference: "EEGScan",
      }));
    }

    /* -------- CREATE EEG SCAN -------- */
    const newEEGScan = new EEGScan({
      nameofexam,
      diagnosis,
      report,
      radiationDose,
      contrastUsed,
      previousStudy,
      relatedStudies,
      aiFindings,
      aiConfidence,
      aiVersion,
      aiPrediction,
      predictionConfidence,
      aiProcessingTime,
      validatedByDoctor,
      doctorNotes,
      threeDModel,
      imageQuality,
      needsRetake,
      riskLevel,
      riskFactors,
      recomandation,

      doctor: doctorId,

      // 🔥 Универсальная ссылка на пациента
      patient: patient._id,
      patientModel: patient.constructor.modelName,

      files: uploadedFiles,

      // 🔥 Governance
      performedOutsideSpecialization,
      doctorSpecializationAtCreation: doctorSpecName,
    });

    await newEEGScan.save();

    /* -------- AUDIT LOG -------- */
    try {
      await AuditLog.createLog({
        action: "CREATE_EEG_SCAN",
        doctor: doctorId,
        userId: doctorId,
        patient: patient._id,
        patientModel: patientModelName,
        studyType: "EEGScan",
        performedOutsideSpecialization,
        doctorSpecialization: doctorSpecName,
        ip: req.ip,
        details: isPrivatePatient ? "Private patient" : "Registered patient",
      });
    } catch (logErr) {
      console.error("❌ AuditLog error (EEGScan):", logErr.message);
    }

    /* -------- RESPONSE (POPULATED) -------- */
    const savedEEGScan = await EEGScan.findById(newEEGScan._id).populate(
      "files",
    );

    // 🔄 AI Auto Refresh — очищаем кеш AI summary пациента
    await invalidatePatientAISummary(patient._id);
    return res.status(201).json({
      message: "✅",
      data: savedEEGScan,
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении обследования:", error);
    return res.status(500).json({
      message: "Error",
      error: error.message,
    });
  }
};

export default addEEGscanController;
