import DoctorVerificationDocument from "../../../common/models/DoctorVerification/DocumentFiles.js";
import mongoose from "mongoose";

export const updateVerificationDocumentController = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reviewComment } = req.body;

    /* ================= VALIDATION ================= */

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid document ID",
      });
    }

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be approved or rejected",
      });
    }

    /* ================= FIND DOCUMENT ================= */

    const document = await DoctorVerificationDocument.findById(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    /* ================= PROTECT AGAINST DOUBLE REVIEW ================= */

    if (document.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Document already reviewed",
      });
    }

    /* ================= UPDATE ================= */

    document.status = status;
    document.reviewComment = reviewComment || "";
    document.reviewedBy = req.userId;
    document.reviewedAt = new Date();

    await document.save();

    return res.status(200).json({
      success: true,
      message: `Document ${status}`,
      document,
    });
  } catch (error) {
    console.error("updateVerificationDocumentController error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating verification document",
    });
  }
};
