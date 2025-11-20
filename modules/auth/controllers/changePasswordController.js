import crypto from "crypto";
import dotenv from "dotenv";
import argon2 from "argon2";
import User from "../../../common/models/Auth/users.js";

dotenv.config();

const SECRET_KEY = process.env.ENCRYPTION_KEY?.padEnd(32, "0");
if (!SECRET_KEY || SECRET_KEY.length !== 32) {
  throw new Error("❌ Error: ENCRYPTION_KEY not found or invalid!");
}

// Функция расшифровки email
const decrypt = (encryptedText) => {
  if (!encryptedText || !encryptedText.includes(":")) return encryptedText;
  try {
    const [iv, encrypted] = encryptedText.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(iv, "hex")
    );
    let decrypted = decipher.update(Buffer.from(encrypted, "hex"));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error("Error decrypting email: ", error);
    return null;
  }
};

// Функция хеширования email (SHA-256)
const hashEmail = (email) => {
  return crypto.createHash("sha256").update(email.toLowerCase()).digest("hex");
};

const changePasswordController = async (req, res) => {
  try {
    const { email, newPassword, newRepeatPassword } = req.body;

    if (!email || !newPassword || !newRepeatPassword) {
      return res
        .status(400)
        .json({ message: "Email and both passwords are required." });
    }

    if (newPassword !== newRepeatPassword) {
      return res.status(400).json({ message: "The passwords do not match." });
    }

    const decryptedEmail = decrypt(email);
    if (!decryptedEmail) {
      return res.status(400).json({ message: "Email decryption error." });
    }

    const emailHash = hashEmail(decryptedEmail);
    console.log("🔍 Ищем пользователя по emailHash:", emailHash);

    const existingUser = await User.findOne({ emailHash });
    if (!existingUser) {
      return res.status(404).json({ message: "User not found." });
    }

    if (existingUser.password) {
      const isSameAsPrevious = await argon2.verify(
        existingUser.password,
        newPassword
      );
      if (isSameAsPrevious) {
        return res.status(400).json({
          message: "The new password must not match the previous one.",
        });
      }
    }

    const hashedPassword = await argon2.hash(newPassword, {
      timeCost: 3,
      memoryCost: 2 ** 16,
      parallelism: 1,
      type: argon2.argon2id,
    });

    existingUser.password = hashedPassword;
    existingUser.mustChangePassword = false; // ✅ Сбрасываем mustChangePassword
    await existingUser.save();

    return res.status(200).json({ message: "Password successfully changed." });
  } catch (error) {
    console.error("Error changing password: ", error);
    return res.status(500).json({
      message: "An error occurred while changing the password.",
      error: error.message,
    });
  }
};

export default changePasswordController;
