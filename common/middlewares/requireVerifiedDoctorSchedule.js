import mongoose from "mongoose";
import DoctorProfile from "../models/DoctorProfile/profileDoctor.js";

export default async function requireVerifiedDoctorSchedule(req, res, next) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const doctorUserId = new mongoose.Types.ObjectId(req.userId);

    const doctorProfile = await DoctorProfile.findOne({
      userId: doctorUserId,
    })
      .select("verificationStatus")
      .lean();

    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found",
      });
    }

    if (doctorProfile.verificationStatus !== "approved") {
      return res.status(403).json({
        success: false,
        code: "DOCTOR_VERIFICATION_REQUIRED",
        message:
          "You must verify your doctor account before creating a schedule.",
      });
    }

    next();
  } catch (error) {
    console.error("❌ requireVerifiedDoctor error:", error);
    return res.status(500).json({
      message: "Verification check failed",
    });
  }
}
