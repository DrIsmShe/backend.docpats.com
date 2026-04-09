import DoctorVerificationDocument from "../../../common/models/DoctorVerification/DocumentFiles.js";
import { deleteFile } from "../../../common/middlewares/uploadMiddleware.js";

const CancelVerificationDocumentController = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { documentId } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const document = await DoctorVerificationDocument.findOne({
      _id: documentId,
      userId,
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    // 🚫 Разрешаем только если pending
    if (document.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Only pending documents can be canceled",
      });
    }

    // 🗑 Удаляем файл из R2 / storage
    await deleteFile(document.fileUrl);

    // 🧹 Удаляем запись из БД
    await DoctorVerificationDocument.deleteOne({
      _id: document._id,
    });

    return res.status(200).json({
      success: true,
      message: "Verification submission canceled successfully",
    });
  } catch (error) {
    console.error("❌ Cancel verification error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while canceling verification document",
    });
  }
};

export default CancelVerificationDocumentController;
