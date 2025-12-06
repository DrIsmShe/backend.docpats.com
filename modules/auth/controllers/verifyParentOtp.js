import User from "../../../common/models/Auth/users.js";
import crypto from "crypto";

// ---------- utils ----------
const safeLower = (v) => (typeof v === "string" ? v.toLowerCase() : "");

const hashData = (data) =>
  crypto.createHash("sha256").update(safeLower(data)).digest("hex");

// ---------- controller ----------
const verifyParentOtp = async (req, res) => {
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

    if (user.parentOtp !== otp || user.parentOtpExpires < Date.now()) {
      return res
        .status(400)
        .json({ message: "Invalid or expired parent OTP." });
    }

    // Подтверждаем родителя
    user.parentOtp = null;
    user.childStatus = "active";
    user.isVerified = true;
    await user.save();

    return res.json({
      message: "Parent approval confirmed. Account activated.",
    });
  } catch (error) {
    console.error("❌ Error in verifyParentOtp:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

export default verifyParentOtp;
