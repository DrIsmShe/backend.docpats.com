import mongoose from "mongoose";
import EEGScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScan.js";
import File from "../../../../common/models/file.js";
import User from "../../../../common/models/Auth/users.js";

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

const addEEGscanController = async (req, res) => {
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
      "Neurologist",
      "Pediatric Neurologist",
      "Radiologist",
      "Functional Diagnostics Specialist",
    ];

    if (!allowedSpecializations.includes(specializationName)) {
      return res.status(403).json({
        message:
          "Access is permitted only to specialists in Neurologist, Pediatric Neurologist, Radiologist, Functional Diagnostics Specialist",
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
    if (Array.isArray(req.uploadedFiles) && req.uploadedFiles.length > 0) {
      const filesToSave = req.uploadedFiles.map((file) => ({
        fileName: file.fileName || "unknown_file",
        fileUrl: file.fileUrl || "unknown_url",
        fileFormat: file.fileFormat || "application/octet-stream",
        fileSize: file.fileSize || 0,
        fileType: resolveFileType(file.fileFormat),
        studyTypeReference: "EEGScan",
        uploadedByDoctor: doctorId, // 🔥 ОБЯЗАТЕЛЬНО!
        patientId: new mongoose.Types.ObjectId(patientId),
      }));

      uploadedFiles = await File.insertMany(filesToSave);
    }

    const newEEGScan = new EEGScan({
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

    await newEEGScan.save();

    const savedEEGScan = await EEGScan.findById(newEEGScan._id).populate(
      "files",
    );

    return res.status(201).json({
      message: "✅ Result added successfully",
      data: savedEEGScan,
    });
  } catch (error) {
    console.error("❌ Error adding result:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export default addEEGscanController;
