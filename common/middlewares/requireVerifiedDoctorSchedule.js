import mongoose from "mongoose";
import DoctorProfile, {
  допускДействует,
} from "../models/DoctorProfile/profileDoctor.js";

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
      .select("verificationStatus verificationExpiresAt")
      .lean();

    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found",
      });
    }

    /* Сравнение со статусом заменено на допускДействует: иначе
       расписание продолжало бы публиковаться по лицензии, срок которой
       вышел. Проверка одна на все ограничители — второй истины о том,
       что такое «подтверждённый врач», быть не должно. */
    if (!допускДействует(doctorProfile)) {
      return res.status(403).json({
        success: false,
        code: "DOCTOR_VERIFICATION_REQUIRED",
        verificationStatus:
          doctorProfile.verificationStatus === "approved"
            ? "expired"
            : doctorProfile.verificationStatus,
        verificationExpiresAt: doctorProfile.verificationExpiresAt || null,
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
