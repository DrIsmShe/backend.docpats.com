import User from "../../../common/models/Auth/users.js";
import { sendEmail } from "../../../common/services/emailService.js";
import crypto from "crypto";
import "dotenv/config";

const SECRET_KEY = process.env.ENCRYPTION_KEY.padEnd(32, "0");

const hashData = (data) => {
  return crypto.createHash("sha256").update(data.toLowerCase()).digest("hex");
};

const decrypt = (text) => {
  if (!text || !text.includes(":")) {
    console.error("❌ [DECRYPT ERROR] Invalid encrypted data format:", text);
    return null;
  }
  try {
    const [iv, encryptedText] = text.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(iv, "hex")
    );
    let decrypted = decipher.update(Buffer.from(encryptedText, "hex"));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error("❌ [DECRYPT ERROR] Decryption failed:", error.message);
    return null;
  }
};

const resetPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  try {
    const user = await User.findOne({ emailHash: hashData(email) });

    if (!user) {
      return res.status(400).json({ message: "Invalid email." });
    }

    const currentTime = Date.now();

    // Проверяем, не истёк ли предыдущий OTP
    if (user.otpExpiresAt && user.otpExpiresAt > currentTime) {
      console.log(
        `🔹 OTP has already been sent to the user ${decrypt(
          user.emailEncrypted
        )}.`
      );
      return res.status(200).json({
        message: "An OTP has already been sent. Please check your email.",
        otpExpiresAt: user.otpExpiresAt,
      });
    }

    // Генерация нового OTP
    const otpPassword = crypto.randomBytes(4).toString("hex").toUpperCase();
    const otpExpiresAt = currentTime + 5 * 60 * 1000;

    user.otpPassword = otpPassword;
    user.otpExpiresAt = otpExpiresAt;
    await user.save();

    await sendEmail(
      decrypt(user.emailEncrypted),
      "Your OTP Code",
      `Your OTP code is: ${otpPassword}. It expires in 5 minutes.`
    );

    console.log(
      `✅ New OTP ${otpPassword} sent to ${decrypt(user.emailEncrypted)}`
    );

    // ✅ Отправляем успешный ответ + время окончания OTP для таймера на фронте
    return res.status(200).json({
      message: "OTP password sent to your email successfully.",
      otpExpiresAt: otpExpiresAt,
    });
  } catch (error) {
    console.error("❌ Error sending OTP to email: ", error);
    return res.status(500).json({
      message: "Failed to send OTP to your email.",
      error: error.message,
    });
  }
};

export default resetPassword;
