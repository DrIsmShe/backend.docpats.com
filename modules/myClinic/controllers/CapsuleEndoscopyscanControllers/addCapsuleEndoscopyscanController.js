import mongoose from "mongoose";
import CapsuleEndoscopyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScan.js";
import File from "../../../../common/models/file.js";
import User from "../../../../common/models/Auth/users.js";

// 🔎 Определение fileType по mimetype
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

const addCapsuleEndoscopyScanController = async (req, res) => {
  try {
    const { patientId } = req.params;
    const doctorId = req.session?.userId;

    if (!mongoose.Types.ObjectId.isValid(patientId)) {
      return res.status(400).json({ message: "Неверный формат ID пациента" });
    }

    if (!doctorId) {
      return res.status(401).json({ message: "Вы не авторизованы" });
    }

    const doctor = await User.findById(doctorId).populate("specialization");
    if (!doctor) {
      return res.status(404).json({ message: "Врач не найден" });
    }

    const specializationName = doctor.specialization?.name;
    const allowedSpecializations = [
      "Ultrasound Diagnostician",
      "Medical Imaging Specialist",
      "Radiologist",
      "Functional Diagnostics Specialist",
      "Bariatric Surgeon",
      "Coloproctologist",
      "Abdominal Surgeon",
      "Gastroenterologist",
    ];

    if (!allowedSpecializations.includes(specializationName)) {
      return res.status(403).json({
        message:
          "Access is permitted only to specialists in Ultrasound Diagnostician, Medical Imaging Specialist, Radiologist, Functional Diagnostics Specialist, Bariatric Surgeon, Coloproctologist, Abdominal Surgeon  and Gastroenterologist ",
      });
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

    // Обработка файлов
    let uploadedFiles = [];
    if (Array.isArray(req.uploadedFiles) && req.uploadedFiles.length > 0) {
      const filesToSave = req.uploadedFiles.map((file) => ({
        fileName: file.fileName || "unknown_file",
        fileUrl: file.fileUrl || "unknown_url",
        fileFormat: file.fileFormat || "application/octet-stream",
        fileSize: file.fileSize || 0,
        fileType: resolveFileType(file.fileFormat),
        studyTypeReference: "CapsuleEndoscopy",
        uploadedByDoctor: doctorId, // 🔥 ОБЯЗАТЕЛЬНО!
        patientId: new mongoose.Types.ObjectId(patientId),
      }));

      uploadedFiles = await File.insertMany(filesToSave);
    }

    // Сохраняем исследование
    const newCapsuleEndoscopyScan = new CapsuleEndoscopyScan({
      nameofexam,
      patientId: new mongoose.Types.ObjectId(patientId),
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
      files: uploadedFiles,
      threeDModel,
      imageQuality,
      needsRetake,
      riskLevel,
      riskFactors,
      recommendation,
      doctor: doctorId,
    });

    await newCapsuleEndoscopyScan.save();

    const savedCapsuleEndoscopyScan = await CapsuleEndoscopyScan.findById(
      newCapsuleEndoscopyScan._id,
    ).populate("files");

    return res.status(201).json({
      message: "✅ Результаты Capsule Endoscopy успешно добавлены",
      data: savedCapsuleEndoscopyScan,
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении CapsuleEndoscopy:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default addCapsuleEndoscopyScanController;
