import DoctorVerificationDocument from "../../../common/models/DoctorVerification/DocumentFiles.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import { uploadFile } from "../../../common/middlewares/uploadMiddleware.js";

const AddVerificationDocumentsController = async (req, res) => {
  try {
    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { documentType } = req.body;

    if (!documentType) {
      return res.status(400).json({
        success: false,
        message: "Document type is required",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "File is required",
      });
    }

    // 🔎 Найти профиль врача
    const doctorProfile = await DoctorProfile.findOne({ userId: userId });

    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found",
      });
    }

    // 🔍 Проверяем, есть ли уже документ этого типа
    const existingDocument = await DoctorVerificationDocument.findOne({
      doctorProfileId: doctorProfile._id,
      documentType,
      status: { $in: ["pending", "approved"] },
    });

    if (existingDocument) {
      // 🚫 Если уже pending
      if (existingDocument.status === "pending") {
        return res.status(400).json({
          success: false,
          message: "You already have a pending document of this type",
        });
      }

      // 🔒 Если уже approved
      if (existingDocument.status === "approved") {
        return res.status(400).json({
          success: false,
          message: "This document type is already approved",
        });
      }

      // ♻ Если rejected — удаляем старый и разрешаем новый
      if (existingDocument.status === "rejected") {
        await DoctorVerificationDocument.deleteOne({
          _id: existingDocument._id,
        });
      }
    }

    // 📤 Загружаем файл (R2 или local)
    const fileUrl = await uploadFile(req.file);

    // 💾 Создаем новый документ
    const newDocument = await DoctorVerificationDocument.create({
      doctorProfileId: doctorProfile._id,
      userId,
      documentType,
      fileUrl,
      fileName: req.file.originalname,
      fileMime: req.file.mimetype,
      fileSize: req.file.size,
      status: "pending",
    });

    return res.status(201).json({
      success: true,
      message: "Verification document uploaded successfully",
      document: newDocument,
    });
  } catch (error) {
    console.error("❌ Verification upload error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while uploading verification document",
      error: error.message,
    });
  }
};

export default AddVerificationDocumentsController;
