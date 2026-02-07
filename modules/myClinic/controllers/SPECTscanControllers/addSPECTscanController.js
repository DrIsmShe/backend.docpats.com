import mongoose from "mongoose";
import SPECTScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScan.js";
import File from "../../../../common/models/file.js";
import User from "../../../../common/models/Auth/users.js";

// 🎯 Утилита для определения типа файла
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

const addSPECTscanController = async (req, res) => {
  try {
    const { patientId } = req.params;
    const doctorId = req.session?.userId;

    if (!mongoose.Types.ObjectId.isValid(patientId)) {
      return res.status(400).json({ message: "❌Invalid patient ID format" });
    }

    if (!doctorId) {
      return res.status(401).json({ message: "⛔You are not logged in" });
    }

    const doctor = await User.findById(doctorId).populate("specialization");
    if (!doctor) {
      return res.status(404).json({ message: "❌ User not found" });
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

    let uploadedFiles = [];
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      const filesToSave = req.uploadedFiles.map((file) => ({
        fileName: file.fileName || "unknown_file",
        fileType: resolveFileType(file.fileFormat),
        fileUrl: file.fileUrl || "unknown_url",
        fileSize: file.fileSize || 0,
        fileFormat: file.fileFormat || "unknown",
        studyTypeReference: "SPECTScan",
        uploadedByDoctor: doctorId, // 🔥 ОБЯЗАТЕЛЬНО!
        patientId: new mongoose.Types.ObjectId(patientId),
      }));

      uploadedFiles = await File.insertMany(filesToSave);
    }

    const newSPECTScan = new SPECTScan({
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

    await newSPECTScan.save();

    const savedSPECTScan = await SPECTScan.findById(newSPECTScan._id).populate(
      "files",
    );

    return res.status(201).json({
      message: "✅ SPECTScan result added successfully",
      data: savedSPECTScan,
    });
  } catch (error) {
    console.error("❌ Error adding SPECTScan:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export default addSPECTscanController;
