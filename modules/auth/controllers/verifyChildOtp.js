import User from "../../../common/models/Auth/users.js";
import crypto from "crypto";

// ---------- utils ----------
const safeLower = (v) => (typeof v === "string" ? v.toLowerCase() : "");

const hashData = (data) =>
  crypto.createHash("sha256").update(safeLower(data)).digest("hex");

// ---------- controller ----------
const verifyChildOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required." });
    }

    const emailHash = hashData(email);
    const user = await User.findOne({ emailHash });

    if (!user || !user.isChild) {
      return res.status(400).json({ message: "Child not found." });
    }

    if (user.childOtp !== otp || user.childOtpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP." });
    }

    // Подтверждаем ребёнка
    user.childOtp = null;
    user.childStatus = "waitingParent";
    await user.save();

    return res.json({
      message: "Child OTP confirmed. Waiting for parent approval.",
    });
  } catch (error) {
    console.error("❌ Error in verifyChildOtp:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

export default verifyChildOtp;
