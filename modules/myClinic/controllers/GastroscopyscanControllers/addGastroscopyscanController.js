import mongoose from "mongoose";
import GastroscopyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScan.js";
import File from "../../../../common/models/file.js";
import User from "../../../../common/models/Auth/users.js";

// 🎯 Утилита для определения допустимого fileType
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

const addGastroscopyScanController = async (req, res) => {
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
      "Bariatric Surgeon",
      "Medical Imaging Specialist",
      "Coloproctologist",
      "Functional Diagnostics Specialist",
      "Abdominal Surgeon",
      "Gastroenterologist",
    ];

    if (!allowedSpecializations.includes(specializationName)) {
      return res.status(403).json({
        message:
          "Access is permitted only to specialists in Bariatric Surgeon, Medical Imaging Specialist, Coloproctologist, Functional Diagnostics Specialist, Abdominal Surgeon, Gastroenterologist .",
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

    let uploadedFiles = [];
    if (Array.isArray(req.uploadedFiles) && req.uploadedFiles.length > 0) {
      const filesToSave = req.uploadedFiles.map((file) => ({
        fileName: file.fileName || "unknown_file",
        fileUrl: file.fileUrl || "unknown_url",
        fileFormat: file.fileFormat || "application/octet-stream",
        fileSize: file.fileSize || 0,
        fileType: resolveFileType(file.fileFormat),
        studyTypeReference: "GastroscopyScan",
        uploadedByDoctor: doctorId, // 🔥 ОБЯЗАТЕЛЬНО!
        patientId: new mongoose.Types.ObjectId(patientId),
      }));

      uploadedFiles = await File.insertMany(filesToSave);
    }

    const newGastroscopyScan = new GastroscopyScan({
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

    await newGastroscopyScan.save();

    const savedGastroscopyScan = await GastroscopyScan.findById(
      newGastroscopyScan._id,
    ).populate("files");

    return res.status(201).json({
      message: "Результаты Gastroscopy успешно добавлены",
      data: savedGastroscopyScan,
    });
  } catch (error) {
    console.error("Ошибка при добавлении Gastroscopy:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default addGastroscopyScanController;
