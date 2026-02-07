import mongoose from "mongoose";
import MRIScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScan.js";
import File from "../../../../common/models/file.js";
import User from "../../../../common/models/Auth/users.js";
import NewPatientPolyclinic from "../../../../common/models/Polyclinic/newPatientPolyclinic.js";

// 🔍 Утилита: определение типа файла по MIME
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

const addMRIScanController = async (req, res) => {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      return res.status(401).json({ message: "⛔ Вы не авторизованы" });
    }

    const doctor = await User.findById(userId).populate("specialization");
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
          "⛔ Access is permitted only to specialists in Radiology and functional diagnostics",
      });
    }

    const { patientId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(patientId)) {
      return res
        .status(400)
        .json({ message: "❌ Неверный формат ID пациента" });
    }

    // ⬇ Проверка пациента по ID
    const patient = await NewPatientPolyclinic.findById(patientId);
    if (!patient) {
      return res.status(404).json({ message: "❌ Пациент не найден" });
    }

    // ⬇ Получение данных из формы
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

    // ⬇ Обработка файлов
    let uploadedFiles = [];
    if (Array.isArray(req.uploadedFiles) && req.uploadedFiles.length > 0) {
      const filesToSave = req.uploadedFiles.map((file) => ({
        fileName: file.fileName || "unknown_file",
        fileType: resolveFileType(file.fileFormat),
        fileUrl: file.fileUrl || "unknown_url",
        fileSize: file.fileSize || 0,
        fileFormat: file.fileFormat || "unknown",
        studyTypeReference: "MRIScan",
        uploadedByDoctor: doctor._id,
        patientId: patient._id,
      }));

      uploadedFiles = await File.insertMany(filesToSave);
    }

    // ⬇ Сохранение МРТ-исследования
    const newMRIScan = new MRIScan({
      nameofexam,
      patientId: patient._id,
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
      doctor: doctor._id,
    });

    await newMRIScan.save();

    const populatedScan = await MRIScan.findById(newMRIScan._id).populate(
      "files",
    );

    return res.status(201).json({
      message: "✅ Результат МРТ успешно добавлен",
      data: populatedScan,
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении МРТ:", error);
    return res.status(500).json({
      message: "Ошибка сервера при сохранении результата",
      error: error.message,
    });
  }
};

export default addMRIScanController;
