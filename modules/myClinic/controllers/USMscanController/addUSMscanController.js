import mongoose from "mongoose";

import File from "../../../../common/models/file.js";

import User from "../../../../common/models/Auth/users.js";

import USMScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMscan.js";

// ✅ Утилита для определения типа файла
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

const addUSMscanController = async (req, res) => {
  try {
    const { patientId } = req.params;
    const doctorId = req.session?.userId;

    if (!mongoose.Types.ObjectId.isValid(patientId)) {
      return res
        .status(400)
        .json({ message: "❌ Неверный формат ID пациента" });
    }

    if (!doctorId) {
      return res.status(401).json({ message: "⛔ Вы не авторизованы" });
    }

    const doctor = await User.findById(doctorId).populate("specialization");
    if (!doctor) {
      return res.status(404).json({ message: "❌ Врач не найден" });
    }

    const specializationName = doctor.specialization?.name;
    const allowedSpecializations = [
      "Ultrasound Diagnostician",
      "Radiologist",
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

    if (!allowedSpecializations.includes(specializationName)) {
      return res.status(403).json({
        success: false,
        message:
          "⛔ Access is permitted only to specialists in Radiology and functional diagnostics, Gynecologist, Obstetrician,  Reproductive Endocrinologist, Urologist,Pediatrician,  Neonatologist, Endocrinologist",
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
        fileType: resolveFileType(file.fileFormat),
        fileUrl: file.fileUrl || "unknown_url",
        fileSize: file.fileSize || 0,
        fileFormat: file.fileFormat || "unknown",
        studyTypeReference: "USMScan",
        uploadedByDoctor: doctorId, // 🔥 ОБЯЗАТЕЛЬНО!
        patientId: new mongoose.Types.ObjectId(patientId),
      }));

      uploadedFiles = await File.insertMany(filesToSave);
    }

    const newUSMScan = new USMScan({
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

    await newUSMScan.save();

    const savedUSMScan = await USMScan.findById(newUSMScan._id).populate(
      "files",
    );

    return res.status(201).json({
      message: "✅ Результаты УЗИ успешно добавлены",
      data: savedUSMScan,
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении УЗИ:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default addUSMscanController;
