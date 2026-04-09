import mongoose from "mongoose";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import DoctorVerificationDocument from "../../../common/models/DoctorVerification/DocumentFiles.js";
import User from "../../../common/models/Auth/users.js";

const PatchVerificationDoctorController = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const adminId = req.session?.userId;
    const { doctorProfileId } = req.params;
    const { status, comment } = req.body;

    if (!adminId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const adminUser = await User.findById(adminId);
    if (!adminUser || adminUser.role !== "admin") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only admin can change verification status",
      });
    }

    const allowedStatuses = ["approved", "rejected", "pending"];
    if (!allowedStatuses.includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Invalid verification status",
      });
    }

    const doctorProfile =
      await DoctorProfile.findById(doctorProfileId).session(session);

    if (!doctorProfile) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found",
      });
    }

    // ================================
    // ОБНОВЛЯЕМ ПРОФИЛЬ
    // ================================

    doctorProfile.verificationStatus = status;
    doctorProfile.verificationReviewedBy = adminId;
    doctorProfile.verificationReviewedAt = new Date();
    doctorProfile.verificationReviewComment = comment || "";

    // 🔥 ВОТ ЭТО ГЛАВНОЕ
    doctorProfile.isVerified = status === "approved";

    await doctorProfile.save({ session });

    // ================================
    // ОБНОВЛЯЕМ ДОКУМЕНТЫ
    // ================================

    await DoctorVerificationDocument.updateMany(
      {
        doctorProfileId: doctorProfile._id,
        status: "pending",
      },
      {
        $set: {
          status: status,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewComment: comment || "",
        },
      },
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: `Doctor verification status updated to ${status}`,
      verificationStatus: doctorProfile.verificationStatus,
      isVerified: doctorProfile.isVerified,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("❌ Patch verification error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while updating verification",
      error: error.message,
    });
  }
};

export default PatchVerificationDoctorController;
