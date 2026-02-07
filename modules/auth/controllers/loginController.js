import User from "../../../common/models/Auth/users.js";
import DoctorProfileModel from "../../../common/models/DoctorProfile/profileDoctor.js";
import PatientProfileModel from "../../../common/models/PatientProfile/patientProfile.js";
import AuditLog from "../../../common/models/auditLog.js";
import argon2 from "argon2";
import crypto from "crypto";
import "dotenv/config";

// ---------------- CRYPTO ----------------
const SECRET_KEY = (process.env.ENCRYPTION_KEY || "")
  .padEnd(32, "0")
  .slice(0, 32);

const hashData = (data) =>
  crypto.createHash("sha256").update(data.toLowerCase()).digest("hex");

const decrypt = (text) => {
  if (!text || !text.includes(":")) return text;
  try {
    const [iv, encryptedText] = text.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(iv, "hex"),
    );
    let decrypted = decipher.update(Buffer.from(encryptedText, "hex"));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error("❌ Email decryption error:", error.message);
    return null;
  }
};

// ---------------- LOGIN CONTROLLER ----------------
export const loginUser = async (req, res) => {
  const { email, password, remember } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Email and password are required." });
  }

  try {
    console.log("📩 Входящие данные:", { email });

    // === Ищем пользователя по хэшу email ===
    const user = await User.findOne({ emailHash: hashData(email) });

    if (!user) {
      return res.status(400).json({ message: "Incorrect email or password." });
    }

    const decryptedEmail = decrypt(user.emailEncrypted);
    console.log(`🔎 Найден пользователь: ${decryptedEmail}`);

    // 🔥 ДЕТИ: блокируем вход, если родитель ещё не подтвердил
    if (user.isChild && user.childStatus !== "active") {
      return res.status(403).json({
        message: "Child account is not yet activated by parent.",
      });
    }

    // 🔥 Аккаунт заблокирован
    if (user.isBlocked) {
      return res
        .status(403)
        .json({ message: "Your account has been blocked." });
    }

    // 🔥 Проверка пароля
    const validPassword = await argon2.verify(user.password, password);
    if (!validPassword) {
      return res.status(400).json({ message: "Incorrect email or password." });
    }

    // 🔥 Система принудительной смены пароля
    if (user.mustChangePassword) {
      return res.status(403).json({
        message: "Password change required.",
        mustChangePassword: true,
      });
    }

    // === Обновляем статус пользователя ===
    user.status = "online";
    user.lastActive = new Date();
    await user.save();

    // === Профиль врача/пациента ===
    let profileData = null;
    if (user.role === "doctor") {
      profileData = await DoctorProfileModel.findOne({ userId: user._id });
    } else if (user.role === "patient") {
      profileData = await PatientProfileModel.findOne({ userId: user._id });
    }

    // === СЕССИЯ ===
    req.session.cookie.maxAge = remember
      ? 30 * 24 * 60 * 60 * 1000
      : 14 * 24 * 60 * 60 * 1000;

    req.session.userId = user._id.toString();

    req.session.username = user.username;
    req.session.email = decryptedEmail;
    req.session.firstName = user.firstName;
    req.session.lastName = user.lastName;
    req.session.role = user.role;
    req.session.status = "online";

    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // === АУДИТ ===
    await AuditLog.create({
      action: "Login",
      userId: user._id,
      timestamp: new Date(),
      ip: req.ip || req.connection?.remoteAddress,
      details: `User ${user.username} logged in successfully.`,
    });

    // === Ответ ===
    return res.status(200).json({
      message: "Login successful",
      user: {
        id: user._id,
        username: user.username,
        email: decryptedEmail,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: "online",
        profileData,
      },
    });
  } catch (error) {
    console.error("❌ Authorization error:", error);
    return res
      .status(500)
      .json({ message: "Login error", error: error.message });
  }
};
