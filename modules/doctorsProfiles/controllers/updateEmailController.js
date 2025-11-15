import User from "../../../common/models/Auth/users.js";
import { sendEmail } from "../../../common/services/emailService.js";
import crypto from "crypto";

const SECRET_KEY = process.env.ENCRYPTION_KEY.padEnd(32, "0");

const hashData = (data) => {
  return crypto.createHash("sha256").update(data.toLowerCase()).digest("hex");
};

const otpStorage = new Map();
const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const updateEmailController = async (req, res) => {
  console.log(
    "🔍 Checking authorization: userId in session",
    req.session.userId
  );

  try {
    const { oldEmail, newEmail, otpCode } = req.body;
    console.log(`🔄 Request to change email: ${oldEmail} → ${newEmail}`);

    if (!req.session.userId) {
      return res.status(403).json({ message: "Please log in." });
    }

    if (!oldEmail || !newEmail) {
      return res
        .status(400)
        .json({ message: "Old and new email are required." });
    }

    if (oldEmail.trim().toLowerCase() === newEmail.trim().toLowerCase()) {
      return res
        .status(400)
        .json({ message: "The new email must not match the old one." });
    }

    const user = await User.findOne({ emailHash: hashData(oldEmail) });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const existingUser = await User.findOne({ emailHash: hashData(newEmail) });
    if (existingUser) {
      return res.status(400).json({ message: "This email is already in use." });
    }

    if (otpCode) {
      console.log(`🔍 Checking OTP code: ${otpCode}`);
      const otpData = otpStorage.get(newEmail);
      if (!otpData || otpData.code !== otpCode) {
        return res.status(400).json({
          message: "The verification code is invalid or has expired.",
        });
      }

      otpStorage.delete(newEmail);
      user.email = newEmail.trim().toLowerCase();
      user.emailHash = hashData(newEmail);
      await user.save();

      return res
        .status(200)
        .json({ message: "Email updated successfully.", newEmail });
    }

    if (otpStorage.has(newEmail)) {
      return res
        .status(429)
        .json({ message: "The code has already been sent, check your email." });
    }

    const otp = generateOtp();
    otpStorage.set(newEmail, { code: otp, timestamp: Date.now() });
    setTimeout(() => otpStorage.delete(newEmail), 300000);

    await sendEmail(
      newEmail,
      "Confirm email change",
      `Your confirmation code: ${otp}`
    );

    return res.status(200).json({
      message: "Confirmation code sent to new email.",
      otpSent: true,
    });
  } catch (error) {
    console.error("❌ Error updating email:", error);
    return res.status(500).json({ message: "Server error." });
  }
};

export default updateEmailController;
