import DoctorVerificationDocument from "../../../common/models/DoctorVerification/DocumentFiles.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";

const getVerificationDocumentsController = async (req, res) => {
  try {
    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const doctorProfile = await DoctorProfile.findOne({ userId });

    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found",
      });
    }

    const documents = await DoctorVerificationDocument.find({
      doctorProfileId: doctorProfile._id,
    }).sort({ createdAt: -1 });

    let overallStatus = doctorProfile.verificationStatus || "not_submitted";

    if (overallStatus !== "approved") {
      if (documents.length > 0) {
        const hasPending = documents.some((doc) => doc.status === "pending");
        const hasRejected = documents.some((doc) => doc.status === "rejected");
        const allApproved = documents.every((doc) => doc.status === "approved");

        if (hasPending) overallStatus = "pending";
        else if (hasRejected) overallStatus = "rejected";
        else if (allApproved) overallStatus = "approved";
      }
    }

    return res.status(200).json({
      success: true,
      verification: {
        overallStatus,
        documents,
      },
    });
  } catch (error) {
    console.error("❌ Get verification status error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export default getVerificationDocumentsController;
