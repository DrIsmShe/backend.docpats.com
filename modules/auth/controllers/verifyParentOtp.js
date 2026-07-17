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
const verifyParentOtp = async (req, res) => {
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
      !otpMatches(otp, user.parentOtp) ||
      !user.parentOtpExpires ||
      user.parentOtpExpires < Date.now()
    ) {
      return res
        .status(400)
        .json({ message: "Invalid or expired confirmation code." });
    }

    // Подтверждаем родителя
    user.parentOtp = null;
    user.childStatus = "active";
    user.isVerified = true;
    await user.save({ validateModifiedOnly: true });

    return res.json({
      message: "Parent approval confirmed. Account activated.",
    });
  } catch (error) {
    console.error("❌ Error in verifyParentOtp:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default verifyParentOtp;
