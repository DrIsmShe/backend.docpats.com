// Контроллер (Backend)
import User from "../../../common/models/Auth/users.js";
import { sendEmail } from "../../../common/services/emailService.js";
import crypto from "crypto";
import "dotenv/config";

const SECRET_KEY = process.env.ENCRYPTION_KEY.padEnd(32, "0");

const hashData = (data) => {
  return crypto.createHash("sha256").update(data.toLowerCase()).digest("hex");
};

const decrypt = (text) => {
  if (!text || !text.includes(":")) return null;
  const [iv, encryptedText] = text.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    Buffer.from(iv, "hex")
  );
  let decrypted = decipher.update(Buffer.from(encryptedText, "hex"));
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
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

    const decryptedEmail = decrypt(user.emailEncrypted);

    const otpPassword = crypto.randomInt(100000, 999999).toString();
    const otpExpiresAt = Date.now() + 5 * 60 * 1000;

    user.otpPassword = otpPassword;
    user.otpExpiresAt = otpExpiresAt;
    await user.save();

    await sendEmail(
      decryptedEmail,
      "Your OTP Code",
      `Your OTP code is: ${otpPassword}. It expires in 5 minutes.`
    );

    return res.status(200).json({
      message: "OTP password sent successfully.",
      otpExpiresAt,
    });
  } catch (error) {
    console.error("❌ Error sending OTP to email:", error);
    return res
      .status(500)
      .json({ message: "Failed to send OTP.", error: error.message });
  }
};

export default resetPassword;
