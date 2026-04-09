import mongoose from "mongoose";
import XRAYScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScan.js";
import User from "../../../../common/models/Auth/users.js";
import AuditLog from "../../../../common/models/auditLog.js";
import { invalidatePatientAISummary } from "../../../aiAssistant/service/aiAutoRefreshService.js";

/* ========================== CONTROLLER ========================== */

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

const addXRAYscanController = async (req, res) => {
  try {
    /* ================= AUTH ================= */

    const doctorId = req.session?.userId;

    if (!doctorId) {
      return res.status(401).json({ message: "⛔ Вы не авторизованы" });
    }

    /* ================= DOCTOR ================= */

    const doctor = await User.findById(doctorId).populate("specialization");

    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found" });
    }

    const doctorSpecName = doctor.specialization?.name || null;

    const allowedSpecializations = [
      "Medical Imaging Specialist",
      "Functional Diagnostics Specialist",
      "Radiologist",
    ];

    /* ================= PATIENT ================= */

    const patient = req.patient;

    if (!patient) {
      return res.status(404).json({ message: "Пациент не найден" });
    }

    const patientModelName = patient.constructor.modelName;
    const isPrivatePatient = PRIVATE_PATIENT_MODELS.includes(patientModelName);

    const patientModel = patientModelName;

    /* ================= SPECIALIZATION CONTROL ================= */

    let performedOutsideSpecialization = false;

    // 🔒 Registered
    if (!isPrivatePatient) {
      if (!doctorSpecName || !allowedSpecializations.includes(doctorSpecName)) {
        return res.status(403).json({
          message:
            "⛔ You do not have sufficient permissions to add an examination for a registered patient",
        });
      }
    } else {
      // 🔓 Private
      if (!doctorSpecName || !allowedSpecializations.includes(doctorSpecName)) {
        performedOutsideSpecialization = true;
      }
    }

    /* ---------- Body ---------- */

    const { nameofexam, diagnosis, report, radiationDose, recomandation } =
      req.body;

    /* ---------- Files ---------- */

    const uploadedFiles =
      Array.isArray(req.uploadedFiles) && req.uploadedFiles.length > 0
        ? req.uploadedFiles.map((file) => ({
            fileName: file.fileName,
            fileType: resolveFileType(file.fileFormat),
            fileUrl: file.fileUrl,
            fileSize: file.fileSize,
            fileFormat: file.fileFormat,
            studyTypeReference: "XRAYScan",
          }))
        : [];

    /* ---------- Create XRAY ---------- */

    const newXRAYScan = await XRAYScan.create({
      nameofexam,
      diagnosis,
      report,
      radiationDose,
      recomandation,

      patient: patient._id,
      patientModel,
      doctor: doctorId,

      files: uploadedFiles,

      performedOutsideSpecialization,
      doctorSpecializationAtCreation: doctorSpecName,
    });

    // 🔄 AI Auto Refresh — очищаем кеш AI summary пациента
    await invalidatePatientAISummary(patient._id);
    /* ---------- Audit ---------- */

    try {
      await AuditLog.createLog({
        action: "CREATE_XRAY_SCAN",
        doctor: doctorId,
        userId: doctorId,
        patient: patient._id,
        patientModel: patientModelName,
        studyType: "XRAYScan",
        performedOutsideSpecialization,
        doctorSpecialization: doctorSpecName,
        ip: req.ip,
        details: isPrivatePatient ? "Private patient" : "Registered patient",
      });
    } catch (logErr) {
      console.error("❌ AuditLog error (XRAYScan):", logErr.message);
    }

    return res.status(201).json({
      message: "✅",
      data: newXRAYScan,
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении обследования:", error);
    return res.status(500).json({
      message: "Error",
      error: error.message,
    });
  }
};

export default addXRAYscanController;
