import User from "../../../common/models/Auth/users.js";
import crypto from "crypto";
import "dotenv/config";

const SECRET_KEY =
  process.env.ENCRYPTION_KEY?.padEnd(32, "0") ||
  "0940e085024139b46bde566fafbddd63";

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

    if (!iv || iv.length !== 32) {
      console.error("❌ [DECRYPT ERROR] Invalid IV length:", iv);
      return null;
    }

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

export const confirmationRegister = async (req, res) => {
  const { email, otpPassword } = req.body;

  if (!email || !otpPassword) {
    return res.status(400).json({ message: "All fields are required." });
  }

  try {
    const user = await User.findOne({ emailHash: hashData(email) });

    if (!user) {
      console.error("❌ [ERROR] User not found or decryption error.");
      return res
        .status(400)
        .json({ message: "User not found or decryption error." });
    }

    if (user.otpPassword === otpPassword) {
      user.isVerified = true;
      user.otpPassword = undefined;
      await user.save();

      return res.status(200).json({ message: "OTP verified successfully" });
    } else {
      return res.status(400).json({ message: "Invalid OTP" });
    }
  } catch (error) {
    console.error("❌ [ERROR] OTP verification failed:", error);
    return res.status(500).json({ message: "OTP verification failed", error });
  }
};
