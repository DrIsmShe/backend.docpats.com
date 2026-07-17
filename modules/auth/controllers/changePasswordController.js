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

// Сравнение двух кодов за постоянное время. Хешируем обе стороны, чтобы
// timingSafeEqual всегда получал буферы равной длины (коды бывают разной
// длины: первое письмо — 8 hex, переотправка — 6 цифр).
const otpMatches = (provided, stored) => {
  if (!provided || !stored) return false;
  const a = crypto.createHash("sha256").update(String(provided).trim()).digest();
  const b = crypto.createHash("sha256").update(String(stored).trim()).digest();
  return crypto.timingSafeEqual(a, b);
};

const changePasswordController = async (req, res) => {
  try {
    const { email, newPassword, newRepeatPassword, otpPassword } = req.body;

    if (!email || !newPassword || !newRepeatPassword) {
      return res
        .status(400)
        .json({ message: "Email and both passwords are required." });
    }

    // ─── КРИТИЧНО: смену пароля подтверждает ТОЛЬКО код из письма ───
    // Без этой проверки любой, кто знает чужой email, мог сменить пароль и
    // войти в аккаунт с медданными. Код доказывает владение почтой.
    if (!otpPassword) {
      return res.status(400).json({
        message: "Confirmation code is required.",
        code: "OTP_REQUIRED",
      });
    }

    if (newPassword !== newRepeatPassword) {
      return res.status(400).json({ message: "The passwords do not match." });
    }

    const decryptedEmail = decrypt(email);
    if (!decryptedEmail) {
      return res.status(400).json({ message: "Email decryption error." });
    }

    const emailHash = hashEmail(decryptedEmail);

    const existingUser = await User.findOne({ emailHash });
    // Одинаковый ответ для «нет пользователя» и «неверный код» — чтобы по
    // этому эндпоинту нельзя было проверять, какие email зарегистрированы.
    if (!existingUser) {
      return res
        .status(400)
        .json({ message: "Invalid or expired confirmation code." });
    }

    // Код должен существовать, не истечь и совпасть.
    const notExpired =
      existingUser.otpExpiresAt &&
      Number(existingUser.otpExpiresAt) > Date.now();
    if (
      !existingUser.otpPassword ||
      !notExpired ||
      !otpMatches(otpPassword, existingUser.otpPassword)
    ) {
      // M-1: считаем неверные попытки; после лимита гасим код, чтобы его нельзя
      // было добить распределённым перебором.
      if (existingUser.otpPassword && notExpired) {
        existingUser.otpAttempts = (existingUser.otpAttempts || 0) + 1;
        if (existingUser.otpAttempts >= 5) {
          existingUser.otpPassword = null;
          existingUser.otpExpiresAt = null;
          existingUser.otpAttempts = 0;
        }
        try {
          await existingUser.save({ validateModifiedOnly: true });
        } catch (e) {
          console.error("❌ Не удалось сохранить счётчик попыток OTP");
        }
      }
      return res
        .status(400)
        .json({ message: "Invalid or expired confirmation code." });
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
    // Код одноразовый — гасим его сразу, чтобы им нельзя было воспользоваться
    // повторно.
    existingUser.otpPassword = null;
    existingUser.otpExpiresAt = null;
    existingUser.otpAttempts = 0; // M-1: сбрасываем счётчик попыток
    await existingUser.save();

    return res.status(200).json({ message: "Password successfully changed." });
  } catch (error) {
    console.error("Error changing password: ", error);
    // M-3: не раскрываем внутренние детали ошибки клиенту.
    return res.status(500).json({
      message: "An error occurred while changing the password.",
    });
  }
};

export default changePasswordController;
