import User from "../../../common/models/Auth/users.js";
import crypto from "crypto";

// ---------- utils ----------
const safeLower = (v) => (typeof v === "string" ? v.toLowerCase() : "");

const hashData = (data) =>
  crypto.createHash("sha256").update(safeLower(data)).digest("hex");

// Сравнение OTP за постоянное время (защита от timing-атаки).
const otpMatches = (provided, stored) => {
  if (!provided || !stored) return false;
  const a = crypto.createHash("sha256").update(String(provided).trim()).digest();
  const b = crypto.createHash("sha256").update(String(stored).trim()).digest();
  return crypto.timingSafeEqual(a, b);
};

// ---------- controller ----------
const verifyChildOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required." });
    }

    const emailHash = hashData(email);
    const user = await User.findOne({ emailHash });

    // Анти-энумерация: тот же ответ, что и на неверный код.
    if (!user || !user.isChild) {
      return res
        .status(400)
        .json({ message: "Invalid or expired confirmation code." });
    }

    if (
      !otpMatches(otp, user.childOtp) ||
      !user.childOtpExpires ||
      user.childOtpExpires < Date.now()
    ) {
      return res
        .status(400)
        .json({ message: "Invalid or expired confirmation code." });
    }

    // Подтверждаем ребёнка
    user.childOtp = null;
    user.childStatus = "waitingParent";
    await user.save({ validateModifiedOnly: true });

    return res.json({
      message: "Child OTP confirmed. Waiting for parent approval.",
    });
  } catch (error) {
    console.error("❌ Error in verifyChildOtp:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default verifyChildOtp;
