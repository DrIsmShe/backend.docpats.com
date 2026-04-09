import mongoose from "mongoose";
import CTScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScan.js";
import File from "../../../../common/models/file.js";
import User from "../../../../common/models/Auth/users.js";
import AuditLog from "../../../../common/models/auditLog.js";
import { invalidatePatientAISummary } from "../../../aiAssistant/service/aiAutoRefreshService.js";

// Функция для безопасного определения fileType
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
const addCTscanController = async (req, res) => {
  try {
    const doctorId = req.session?.userId;
    const { patient } = req; // 👈 resolvePatient положил сюда документ пациента

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
      "Medical Imaging Specialist",
      "Functional Diagnostics Specialist",
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

    const {
      nameofexam,
      diagnosis,
      report,
      radiationDose,
      contrastUsed,
      recomandation,
    } = req.body;

    // 🔗 Универсальная ссылка на пациента (registered / private)
    const patientRef = {
      patient: patient._id,
      patientModel: patient.constructor.modelName, // "NewPatientPolyclinic" или "DoctorPrivatePatient"
    };

    // ===== FILES =====
    // ===== FILES =====
    let uploadedFiles = [];

    if (Array.isArray(req.uploadedFiles) && req.uploadedFiles.length > 0) {
      uploadedFiles = req.uploadedFiles.map((file) => ({
        fileName: file.fileName,
        fileUrl: file.fileUrl,
        fileFormat: file.fileFormat,
        fileSize: file.fileSize,
        fileType: resolveFileType(file.fileFormat),
        studyTypeReference: "CTScan",
      }));
    }

    // ===== CT SCAN =====
    const newCTScan = new CTScan({
      nameofexam,
      diagnosis,
      report,
      radiationDose,
      contrastUsed,
      recomandation,
      doctor: doctorId,
      files: uploadedFiles,
      patient: patient._id,
      patientModel: patient.constructor.modelName,

      // 🔥 КЛЮЧЕВОЕ
      performedOutsideSpecialization,
      doctorSpecializationAtCreation: doctorSpecName,
    });

    await newCTScan.save();
    try {
      await AuditLog.createLog({
        action: "CREATE_CT_SCAN",
        doctor: doctorId,
        userId: doctorId,
        patient: patient._id,
        patientModel: patientModelName,
        studyType: "AngiographyScan",
        performedOutsideSpecialization,
        doctorSpecialization: doctorSpecName,
        ip: req.ip,
        details: isPrivatePatient ? "Private patient" : "Registered patient",
      });
    } catch (logErr) {
      console.error("❌ AuditLog error (CTScan):", logErr.message);
    }
    const saved = await CTScan.findById(newCTScan._id).populate("files");
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

export default addCTscanController;
