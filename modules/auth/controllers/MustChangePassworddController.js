import crypto from "crypto";
import User from "../../../common/models/Auth/users.js";
import argon2 from "argon2";

const SECRET_KEY = process.env.ENCRYPTION_KEY?.padEnd(32, "0");
if (!SECRET_KEY || SECRET_KEY.length !== 32) {
  throw new Error("❌ Ошибка: ENCRYPTION_KEY не найден или некорректен!");
}

// Функция расшифровки email
const decrypt = (encryptedText) => {
  if (!encryptedText || !encryptedText.includes(":")) return encryptedText;
  const [iv, encrypted] = encryptedText.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    Buffer.from(iv, "hex")
  );
  let decrypted = decipher.update(Buffer.from(encrypted, "hex"));
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
};

const changePasswordController = async (req, res) => {
  const { email, newPassword, newRepeatPassword } = req.body;

  if (!email || !newPassword || !newRepeatPassword) {
    return res
      .status(400)
      .json({ message: "Email and both passwords are required." });
  }

  if (newPassword !== newRepeatPassword) {
    return res.status(400).json({ message: "The passwords do not match." });
  }

  try {
    // Декодируем email, так как он хранится в зашифрованном виде
    const decryptedEmail = decrypt(email);

    const existingUser = await User.findOne({ emailEncrypted: email });

    if (!existingUser) {
      return res.status(404).json({ message: "User not found." });
    }

    if (existingUser.password) {
      const isSameAsPrevious = await argon2.verify(
        existingUser.password,
        newPassword + PEPPER
      );
      if (isSameAsPrevious) {
        return res.status(400).json({
          message:
            "The new password must not be the same as the previous one..",
        });
      }
    }

    const hashedPassword = await argon2.hash(newPassword + PEPPER, {
      timeCost: 3,
      memoryCost: 2 ** 16,
      parallelism: 1,
      type: argon2.argon2id,
    });

    existingUser.password = hashedPassword;
    await existingUser.save();

    return res.status(200).json({ message: "Password changed successfully." });
  } catch (error) {
    console.error("Error changing password: ", error);
    return res.status(500).json({
      message: "An error occurred while changing the password.",
      error: error.message,
    });
  }
};

export default changePasswordController;
