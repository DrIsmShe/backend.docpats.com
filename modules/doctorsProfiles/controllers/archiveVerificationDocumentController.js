import DoctorVerificationDocument from "../../../common/models/DoctorVerification/DocumentFiles.js";

const ArchiveVerificationDocumentController = async (req, res) => {
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

    // Разрешаем архивировать ТОЛЬКО rejected
    if (document.status !== "rejected") {
      return res.status(400).json({
        success: false,
        message: "Only rejected documents can be archived",
      });
    }

    document.isArchivedByDoctor = true;
    document.archivedAt = new Date();

    await document.save();

    return res.status(200).json({
      success: true,
      message: "Document archived successfully",
    });
  } catch (error) {
    console.error("Archive error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export default ArchiveVerificationDocumentController;
