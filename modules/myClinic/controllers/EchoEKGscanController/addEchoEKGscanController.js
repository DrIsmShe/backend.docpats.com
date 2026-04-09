import mongoose from "mongoose";
import EchoEKGscan from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGscan.js";
import File from "../../../../common/models/file.js";
import User from "../../../../common/models/Auth/users.js";
import AuditLog from "../../../../common/models/auditLog.js";
import { invalidatePatientAISummary } from "../../../aiAssistant/service/aiAutoRefreshService.js";

// 🎯 Утилита для определения допустимого типа файла
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

const PRIVATE_PATIENT_MODELS = ["DoctorPrivatePatient"];

const addEKGScanController = async (req, res) => {
  try {
    const doctorId = req.session?.userId;
    const { patient } = req; // 🔥 resolvePatient кладёт пациента сюда

    /* ================= AUTH ================= */
    if (!doctorId) {
      return res.status(401).json({ message: "⛔ Вы не авторизованы" });
    }

    if (!patient) {
      return res.status(404).json({ message: "❌ Пациент не найден" });
    }

    /* ================= DOCTOR ================= */

    const doctor = await User.findById(doctorId).populate("specialization");
    if (!doctor) {
      return res.status(404).json({ message: "❌ Врач не найден" });
    }

    const allowedSpecializations = [
      "Ultrasound Diagnostician",
      "Medical Imaging Specialist",
      "Functional Diagnostics Specialist",
      "Cardiologist",
      "Interventional Cardiologist",
      "Pediatric Cardiologist",
      "Radiologist",
    ];

    const patientModelName = patient.constructor?.modelName;
    const isPrivatePatient = PRIVATE_PATIENT_MODELS.includes(patientModelName);
    const doctorSpecName = doctor.specialization?.name || null;

    let performedOutsideSpecialization = false;

    // 🔒 Registered → строгий контроль
    if (!isPrivatePatient) {
      if (!doctorSpecName || !allowedSpecializations.includes(doctorSpecName)) {
        return res.status(403).json({
          message:
            "⛔ You do not have sufficient permissions to add an examination for a registered patient",
        });
      }
    } else {
      // 🔓 Private → разрешаем, но фиксируем
      if (!doctorSpecName || !allowedSpecializations.includes(doctorSpecName)) {
        performedOutsideSpecialization = true;
      }
    }

    /* ================= BODY ================= */

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
      recommendation,
    } = req.body;

    /* ================= FILES ================= */

    let uploadedFiles = [];

    if (Array.isArray(req.uploadedFiles) && req.uploadedFiles.length > 0) {
      uploadedFiles = req.uploadedFiles.map((file) => ({
        fileName: file.fileName,
        fileUrl: file.fileUrl,
        fileFormat: file.fileFormat,
        fileSize: file.fileSize,
        fileType: resolveFileType(file.fileFormat),
        studyTypeReference: "EchoEKGScan",
      }));
    }

    /* ================= CREATE DOCUMENT ================= */

    const newEchoEKGscan = new EchoEKGscan({
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
      recommendation,

      doctor: doctorId,
      files: uploadedFiles,

      // 🔥 УНИВЕРСАЛЬНАЯ СВЯЗКА
      patient: patient._id,
      patientModel: patient.constructor.modelName,

      // 🔥 Governance
      performedOutsideSpecialization,
      doctorSpecializationAtCreation: doctorSpecName,
    });

    await newEchoEKGscan.save();

    /* ================= AUDIT LOG ================= */

    try {
      await AuditLog.createLog({
        action: "CREATE_ECHOEKG_SCAN",
        doctor: doctorId,
        userId: doctorId,
        patient: patient._id,
        patientModel: patientModelName,
        studyType: "EchoEKGScan",
        performedOutsideSpecialization,
        doctorSpecialization: doctorSpecName,
        ip: req.ip,
        details: isPrivatePatient ? "Private patient" : "Registered patient",
      });
    } catch (logErr) {
      console.error("❌ AuditLog error (EchoEKGscan):", logErr.message);
    }

    /* ================= POPULATE RESPONSE ================= */

    const saved = await EchoEKGscan.findById(newEchoEKGscan._id).populate(
      "files",
    );

    // 🔄 AI Auto Refresh — очищаем кеш AI summary пациента
    await invalidatePatientAISummary(patient._id);
    return res.status(201).json({
      message: "✅",
      data: saved,
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении обследования:", error);
    return res.status(500).json({
      message: "Error",
      error: error.message,
    });
  }
};

export default addEKGScanController;
