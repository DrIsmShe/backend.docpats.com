import mongoose from "mongoose";
import GinecologyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/Ginecology.js";
import File from "../../../../common/models/file.js";
import User from "../../../../common/models/Auth/users.js";
import AuditLog from "../../../../common/models/auditLog.js"; // путь подгони под свой
import { invalidatePatientAISummary } from "../../../aiAssistant/service/aiAutoRefreshService.js";

// 🎯 Безопасное определение типа файла
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

const AddGinecologyscanController = async (req, res) => {
  try {
    const doctorId = req.session?.userId;
    const { patient } = req; // resolvePatient

    if (!doctorId) {
      return res.status(401).json({ message: "⛔ Вы не авторизованы" });
    }

    if (!patient) {
      return res.status(404).json({ message: "❌ Пациент не найден" });
    }

    const doctor = await User.findById(doctorId).populate("specialization");
    if (!doctor) {
      return res.status(404).json({ message: "❌ Врач не найден" });
    }

    const allowedSpecializations = [
      "Gynecologist",
      "Obstetrician",
      "Reproductive Endocrinologist",
      "Gynecologic Oncologist",
      "Breast Specialist",
      "Menopause Specialist",
      "Radiologist",
    ];

    const patientModelName = patient.constructor?.modelName;
    const isPrivatePatient = PRIVATE_PATIENT_MODELS.includes(patientModelName);
    const doctorSpecName = doctor.specialization?.name || null;

    let performedOutsideSpecialization = false;

    if (!isPrivatePatient) {
      // Registered → строгий контроль
      if (!doctorSpecName || !allowedSpecializations.includes(doctorSpecName)) {
        return res.status(403).json({
          message:
            "⛔ You do not have sufficient permissions to add an examination for a registered patient",
        });
      }
    } else {
      // Private → разрешаем, но фиксируем, если не входит в список
      if (!doctorSpecName || !allowedSpecializations.includes(doctorSpecName)) {
        performedOutsideSpecialization = true;
      }
    }

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

    const patientRef = {
      patient: patient._id,
      patientModel: patientModelName,
    };

    let uploadedFiles = [];

    if (Array.isArray(req.uploadedFiles) && req.uploadedFiles.length > 0) {
      uploadedFiles = req.uploadedFiles.map((file) => ({
        fileName: file.fileName,
        fileUrl: file.fileUrl,
        fileFormat: file.fileFormat,
        fileSize: file.fileSize,
        fileType: resolveFileType(file.fileFormat),
        studyTypeReference: "GinecologyScan",
      }));
    }

    const newGinecologyScan = new GinecologyScan({
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
      patient: patientRef.patient,
      patientModel: patientRef.patientModel,
      performedOutsideSpecialization,
      doctorSpecializationAtCreation: doctorSpecName,
    });

    await newGinecologyScan.save();

    // 🔍 АУДИТ-ЛОГ (не ломает ответ пользователю, даже если упадёт)
    try {
      await AuditLog.createLog({
        action: "CREATE_GINECOLOGY_SCAN",
        doctor: doctorId,
        userId: doctorId,
        patient: patient._id,
        patientModel: patientModelName,
        studyType: "GinecologyScan",
        performedOutsideSpecialization,
        doctorSpecialization: doctorSpecName,
        ip: req.ip,
        details: isPrivatePatient ? "Private patient" : "Registered patient",
      });
    } catch (logErr) {
      console.error("❌ AuditLog error (Ginecology):", logErr.message);
    }

    const saved = await GinecologyScan.findById(newGinecologyScan._id).populate(
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

export default AddGinecologyscanController;
