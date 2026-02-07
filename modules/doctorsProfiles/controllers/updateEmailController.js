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
  console.log("🔍 Checking authorization:", req.session.userId);

  try {
    const { oldEmail, newEmail, otpCode } = req.body;
    console.log(`🔄 Email change request: ${oldEmail} → ${newEmail}`);

    if (!req.session.userId) {
      return res.status(403).json({ message: "Please log in." });
    }

    if (!oldEmail || !newEmail) {
      return res.status(400).json({
        message: "Both old and new emails are required.",
      });
    }

    if (oldEmail.trim().toLowerCase() === newEmail.trim().toLowerCase()) {
      return res.status(400).json({
        message: "The new email must be different from the old one.",
      });
    }

    const user = await User.findOne({ emailHash: hashData(oldEmail) });

    if (!user) {
      return res.status(404).json({ message: "Old email not found." });
    }

    const existingUser = await User.findOne({ emailHash: hashData(newEmail) });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "This new email is already used." });
    }

    // =============================
    //  Проверка OTP
    // =============================
    if (otpCode) {
      console.log(`🔍 Verifying OTP: ${otpCode}`);

      const otpData = otpStorage.get(newEmail);

      if (!otpData || otpData.code !== otpCode) {
        return res.status(400).json({
          message: "Invalid or expired verification code.",
        });
      }

      // Удаляем из памяти
      otpStorage.delete(newEmail);

      // Обновляем email
      user.email = newEmail.trim().toLowerCase();
      user.emailHash = hashData(newEmail);
      await user.save();

      return res.status(200).json({
        message: "Email updated successfully.",
        newEmail,
      });
    }

    // =============================
    //  Если OTP уже отправлен
    // =============================
    if (otpStorage.has(newEmail)) {
      return res.status(429).json({
        message:
          "The confirmation code was already sent. Please check your email.",
      });
    }

    // =============================
    //  Создаём новый OTP
    // =============================
    const otp = generateOtp();
    otpStorage.set(newEmail, { code: otp, timestamp: Date.now() });

    // Очищаем через 5 минут
    setTimeout(() => otpStorage.delete(newEmail), 300000);

    // =============================
    //  ОТПРАВКА ПИСЬМА НА 2 EMAIL
    // =============================
    await sendEmail(
      [oldEmail, newEmail], // 👈 ОТПРАВКА НА ДВА АДРЕСА
      "Confirm your email change",
      `Your verification code: ${otp}`
    );

    return res.status(200).json({
      message: "Confirmation code sent to both emails.",
      otpSent: true,
    });
  } catch (error) {
    console.error("❌ Error updating email:", error);
    return res.status(500).json({ message: "Server error." });
  }
};

export default updateEmailController;
