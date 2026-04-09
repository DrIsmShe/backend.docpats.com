import mongoose from "mongoose";
import PETScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScan.js";
import User from "../../../../common/models/Auth/users.js";
import AuditLog from "../../../../common/models/auditLog.js";
import { invalidatePatientAISummary } from "../../../aiAssistant/service/aiAutoRefreshService.js";

/* ========================== HELPERS ========================== */

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

/* ========================== CONTROLLER ========================== */

const addPETscanController = async (req, res) => {
  try {
    /* ================= AUTH ================= */

    const doctorId = req.session?.userId;

    if (!doctorId) {
      return res.status(401).json({ message: "⛔ Вы не авторизованы" });
    }

    /* ================= PATIENT ================= */

    const patient = req.patient;

    if (!patient) {
      return res.status(404).json({ message: "Пациент не найден" });
    }

    const patientModel = patient.constructor.modelName;
    const patientModelName = patientModel;
    const isPrivatePatient = PRIVATE_PATIENT_MODELS.includes(patientModelName);

    /* ================= DOCTOR ================= */

    const doctor = await User.findById(doctorId).populate("specialization");

    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found" });
    }

    const doctorSpecName = doctor.specialization?.name || null;

    const allowedSpecializations = [
      "Radiologist",
      "Medical Imaging Specialist",
      "Functional Diagnostics Specialist",
    ];

    let performedOutsideSpecialization = false;

    /* ================= SPECIALIZATION CONTROL ================= */

    // 🔒 Registered → строгий запрет
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
      recomandation,
    } = req.body;

    /* ================= FILES ================= */

    const uploadedFiles =
      Array.isArray(req.uploadedFiles) && req.uploadedFiles.length > 0
        ? req.uploadedFiles.map((file) => ({
            fileName: file.fileName,
            fileType: resolveFileType(file.fileFormat),
            fileUrl: file.fileUrl,
            fileSize: file.fileSize,
            fileFormat: file.fileFormat,
            studyTypeReference: "PETScan",
          }))
        : [];

    /* ================= CREATE DOCUMENT ================= */

    const newPETScan = await PETScan.create({
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

      patient: patient._id,
      patientModel,
      doctor: doctorId,
      files: uploadedFiles,

      // 🔥 Governance fields
      performedOutsideSpecialization,
      doctorSpecializationAtCreation: doctorSpecName,
    });
    // 🔄 AI Auto Refresh — очищаем кеш AI summary пациента
    await invalidatePatientAISummary(patient._id);
    /* ================= AUDIT LOG ================= */

    try {
      await AuditLog.createLog({
        action: "CREATE_PET_SCAN",
        doctor: doctorId,
        userId: doctorId,
        patient: patient._id,
        patientModel: patientModelName,
        studyType: "PETScan",
        performedOutsideSpecialization,
        doctorSpecialization: doctorSpecName,
        ip: req.ip,
        details: isPrivatePatient ? "Private patient" : "Registered patient",
      });
    } catch (logErr) {
      console.error("❌ AuditLog error (PETScan):", logErr.message);
    }

    /* ================= RESPONSE ================= */

    return res.status(201).json({
      message: "✅",
      data: newPETScan,
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении обследования:", error);
    return res.status(500).json({
      message: "Error",
      error: error.message,
    });
  }
};

export default addPETscanController;
