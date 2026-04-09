import mongoose from "mongoose";
import USMScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMscan.js";
import File from "../../../../common/models/file.js";
import User from "../../../../common/models/Auth/users.js";
import AuditLog from "../../../../common/models/auditLog.js";
import { invalidatePatientAISummary } from "../../../aiAssistant/service/aiAutoRefreshService.js";

// 🔍 MIME → fileType
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
  )
    return "document";
  return "other";
}

const PRIVATE_PATIENT_MODELS = ["DoctorPrivatePatient"];

const addUSMscanController = async (req, res) => {
  try {
    /* ================= AUTH ================= */

    const userId = req.session?.userId;

    if (!userId) {
      return res.status(401).json({ message: "⛔ Вы не авторизованы" });
    }

    /* ================= DOCTOR ================= */

    const doctor = await User.findById(userId).populate("specialization");

    if (!doctor) {
      return res.status(404).json({ message: "❌ Врач не найден" });
    }

    const doctorSpecName = doctor.specialization?.name || null;

    const allowedSpecializations = [
      "Radiologist",
      "Ultrasound Diagnostician",
      "Gynecologist",
      "Obstetrician",
      "Reproductive Endocrinologist",
      "Cardiologist",
      "Urologist",
      "Breast Specialist",
      "Vascular Surgeon",
      "Pediatrician",
      "Neonatologist",
      "Endocrinologist",
    ];

    /* ================= PATIENT ================= */

    const { patient } = req;

    if (!patient) {
      return res.status(404).json({ message: "❌ Пациент не найден" });
    }

    const patientModelName = patient.constructor.modelName;
    const isPrivatePatient = PRIVATE_PATIENT_MODELS.includes(patientModelName);

    const patientModel = patientModelName;

    /* ================= SPECIALIZATION CONTROL ================= */

    let performedOutsideSpecialization = false;

    // 🔒 Registered → строгий контроль
    if (!isPrivatePatient) {
      if (!doctorSpecName || !allowedSpecializations.includes(doctorSpecName)) {
        return res.status(403).json({
          message:
            "⛔ Недостаточно прав для добавления исследования зарегистрированному пациенту",
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
        fileName: file.fileName || "unknown_file",
        fileType: resolveFileType(file.fileFormat),
        fileUrl: file.fileUrl || "unknown_url",
        fileSize: file.fileSize || 0,
        fileFormat: file.fileFormat || "unknown",
        studyTypeReference: "USMScan",
      }));
    }

    /* ================= CREATE DOCUMENT ================= */

    const newUSMScan = new USMScan({
      nameofexam,
      patient: patient._id,
      patientModel,
      doctor: doctor._id,

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

      files: uploadedFiles,

      performedOutsideSpecialization,
      doctorSpecializationAtCreation: doctorSpecName,
    });

    await newUSMScan.save();
    // 🔄 AI Auto Refresh — очищаем кеш AI summary пациента
    await invalidatePatientAISummary(patient._id);
    /* ================= AUDIT LOG ================= */

    try {
      await AuditLog.createLog({
        action: "CREATE_USM_SCAN",
        doctor: userId,
        userId: userId,
        patient: patient._id,
        patientModel: patientModelName,
        studyType: "USMScan",
        performedOutsideSpecialization,
        doctorSpecialization: doctorSpecName,
        ip: req.ip,
        details: isPrivatePatient ? "Private patient" : "Registered patient",
      });
    } catch (logErr) {
      console.error("❌ AuditLog error (USMScan):", logErr.message);
    }

    /* ================= POPULATE RESPONSE ================= */

    const populatedScan = await USMScan.findById(newUSMScan._id).populate(
      "files",
    );

    return res.status(201).json({
      message: "✅",
      data: newUSMScan,
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении обследования:", error);
    return res.status(500).json({
      message: "Error",
      error: error.message,
    });
  }
};

export default addUSMscanController;
