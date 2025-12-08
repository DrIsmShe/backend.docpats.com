import User from "../../../common/models/Auth/users.js";
import crypto from "crypto";

const hashData = (data) =>
  crypto.createHash("sha256").update(String(data).toLowerCase()).digest("hex");

export const confirmationChildeController = async (req, res) => {
  try {
    const { email, childOtp, parentOtp } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const emailHash = hashData(email);
    const user = await User.findOne({ emailHash });

    if (!user || !user.isChild) {
      return res.status(400).json({ message: "Child account not found." });
    }

    // -----------------------------------------
    // 1️⃣ Подтверждение ребёнка (используем otpPassword)
    // -----------------------------------------
    if (childOtp) {
      if (
        user.otpPassword !== childOtp || // ← СРАВНИВАЕМ С otpPassword
        !user.otpExpiresAt ||
        user.otpExpiresAt < Date.now()
      ) {
        return res
          .status(400)
          .json({ message: "Invalid or expired child OTP." });
      }

      // очищаем код ребёнка
      user.otpPassword = null;
      user.otpExpiresAt = null;

      user.childStatus = "waitingParent"; // ждём родителя
      await user.save();

      return res.json({
        message: "Child OTP confirmed. Waiting for parent approval.",
        step: "parent",
      });
    }

    // -----------------------------------------
    // 2️⃣ Подтверждение родителя (как было)
    // -----------------------------------------
    if (parentOtp) {
      if (
        user.parentOtp !== parentOtp ||
        !user.parentOtpExpires ||
        user.parentOtpExpires < Date.now()
      ) {
        return res
          .status(400)
          .json({ message: "Invalid or expired parent OTP." });
      }

      user.parentOtp = null;
      user.parentOtpExpires = null;

      user.childStatus = "active";
      user.isVerified = true;
      await user.save();

      return res.json({
        message: "Parent approval confirmed. Account activated.",
        step: "done",
      });
    }

    return res.status(400).json({
      message: "childOtp or parentOtp is required.",
    });
  } catch (error) {
    console.error("❌ Error in confirmationChildeController:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};
