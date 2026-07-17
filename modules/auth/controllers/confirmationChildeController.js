import User from "../../../common/models/Auth/users.js";
import crypto from "crypto";

const hashData = (data) =>
  crypto.createHash("sha256").update(String(data).toLowerCase()).digest("hex");

// Сравнение OTP за постоянное время (защита от timing-атаки).
const otpMatches = (provided, stored) => {
  if (!provided || !stored) return false;
  const a = crypto.createHash("sha256").update(String(provided).trim()).digest();
  const b = crypto.createHash("sha256").update(String(stored).trim()).digest();
  return crypto.timingSafeEqual(a, b);
};

export const confirmationChildeController = async (req, res) => {
  try {
    const { email, childOtp, parentOtp } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const emailHash = hashData(email);
    const user = await User.findOne({ emailHash });

    // Анти-энумерация: не раскрываем, существует ли детский аккаунт —
    // тот же ответ, что и на неверный код.
    if (!user || !user.isChild) {
      return res
        .status(400)
        .json({ message: "Invalid or expired confirmation code." });
    }

    // -----------------------------------------
    // 1️⃣ Подтверждение ребёнка (используем otpPassword)
    // -----------------------------------------
    if (childOtp) {
      if (
        !otpMatches(childOtp, user.otpPassword) || // constant-time сравнение
        !user.otpExpiresAt ||
        user.otpExpiresAt < Date.now()
      ) {
        return res
          .status(400)
          .json({ message: "Invalid or expired confirmation code." });
      }

      // очищаем код ребёнка
      user.otpPassword = null;
      user.otpExpiresAt = null;

      user.childStatus = "waitingParent"; // ждём родителя
      await user.save({ validateModifiedOnly: true });

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
        !otpMatches(parentOtp, user.parentOtp) || // constant-time сравнение
        !user.parentOtpExpires ||
        user.parentOtpExpires < Date.now()
      ) {
        return res
          .status(400)
          .json({ message: "Invalid or expired confirmation code." });
      }

      user.parentOtp = null;
      user.parentOtpExpires = null;

      user.childStatus = "active";
      user.isVerified = true;
      await user.save({ validateModifiedOnly: true });

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
    // Не раскрываем внутренние детали ошибки клиенту.
    return res.status(500).json({ message: "Internal server error" });
  }
};
