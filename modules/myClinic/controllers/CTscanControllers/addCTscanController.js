import mongoose from "mongoose";
import CTScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScan.js";
import File from "../../../../common/models/file.js";
import User from "../../../../common/models/Auth/users.js";

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
  )
    return "document";
  return "other";
}

const addCTscanController = async (req, res) => {
  try {
    const { patientId } = req.params;
    const doctorId = req.session?.userId;

    if (!mongoose.Types.ObjectId.isValid(patientId)) {
      return res.status(400).json({ message: "❌ Invalid patient ID format" });
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
      "Radiologist",
      "Medical Imaging Specialist",
      "Functional Diagnostics Specialist",
    ];

    if (!allowedSpecializations.includes(specializationName)) {
      return res.status(403).json({
        message:
          "⛔ Access is permitted only to specialists in Radiologist, Imaging Specialist, Functional Diagnostics Specialist.",
      });
    }

    // Извлекаем данные из тела запроса
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

    // Обработка загруженных файлов
    let uploadedFiles = [];
    if (Array.isArray(req.uploadedFiles) && req.uploadedFiles.length > 0) {
      const filesToSave = req.uploadedFiles.map((file) => ({
        fileName: file.fileName || "unknown_file",
        fileUrl: file.fileUrl || "unknown_url",
        fileFormat: file.fileFormat || "application/octet-stream",
        fileSize: file.fileSize || 0,
        fileType: resolveFileType(file.fileFormat),
        studyTypeReference: "CTScan",
        uploadedByDoctor: doctorId, // 🔥 ОБЯЗАТЕЛЬНО!
        patientId: new mongoose.Types.ObjectId(patientId),
      }));

      uploadedFiles = await File.insertMany(filesToSave);
    }

    // Создание новой записи КТ
    const newCTScan = new CTScan({
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
      recomandation,
      doctor: doctorId,
    });

    await newCTScan.save();

    const savedCTScan = await CTScan.findById(newCTScan._id).populate("files");

    return res.status(201).json({
      message: "✅ CT-исследование успешно добавлено",
      data: savedCTScan,
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении CT-исследования:", error);
    return res.status(500).json({
      message: "Ошибка сервера при сохранении результата",
      error: error.message,
    });
  }
};

export default addCTscanController;
