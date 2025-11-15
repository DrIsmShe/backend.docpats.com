import User from "../../../common/models/Auth/users.js";
import DoctorProfileModel from "../../../common/models/DoctorProfile/profileDoctor.js";
import PatientProfileModel from "../../../common/models/PatientProfile/patientProfile.js";
import AuditLog from "../../../common/models/auditLog.js";
import argon2 from "argon2";
import crypto from "crypto";
import "dotenv/config";

const SECRET_KEY = process.env.ENCRYPTION_KEY.padEnd(32, "0");

// ======================= HASH & DECRYPT =======================
const hashData = (data) => {
  return crypto.createHash("sha256").update(data.toLowerCase()).digest("hex");
};

const decrypt = (text) => {
  if (!text || !text.includes(":")) return text;
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
    console.error("❌ Email decryption error:", error.message);
    return null;
  }
};

// ======================= LOGIN CONTROLLER =======================
export const loginUser = async (req, res) => {
  const { email, password, remember } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Email and password are required." });
  }

  try {
    console.log("📩 Входящие данные:", { email, password });

    const user = await User.findOne({ emailHash: hashData(email) });
    if (!user) {
      console.log("❌ Email not found in database:", email);
      return res.status(400).json({ message: "Incorrect email or password." });
    }

    const decryptedEmail = decrypt(user.emailEncrypted);
    console.log(`✅ Найден пользователь: ${decryptedEmail}`);

    if (user.isBlocked) {
      console.log(`🚫 Account ${decryptedEmail} has been blocked`);
      return res
        .status(403)
        .json({ message: "Your account has been blocked." });
    }

    const validPassword = await argon2.verify(user.password, password);
    if (!validPassword) {
      console.log("❌ Incorrect password for user:", user.username);
      return res.status(400).json({ message: "Incorrect email or password." });
    }

    if (user.mustChangePassword) {
      console.log(
        `🔴 mustChangePassword = true for the user ${decryptedEmail}`
      );
      return res.status(403).json({
        message: "Password change required.",
        mustChangePassword: true,
      });
    }

    // === Обновляем статус пользователя ===
    user.status = "online";
    user.lastActive = new Date();
    await user.save();

    // === Профиль врача или пациента ===
    let profileData = null;
    if (user.role === "doctor") {
      profileData = await DoctorProfileModel.findOne({ userId: user._id });
    } else if (user.role === "patient") {
      profileData = await PatientProfileModel.findOne({ userId: user._id });
    }

    // === Сессия ===
    req.session.cookie.maxAge = remember
      ? 30 * 24 * 60 * 60 * 1000
      : 14 * 24 * 60 * 60 * 1000;
    req.session.userId = user._id;
    req.session.username = user.username;
    req.session.email = decryptedEmail;
    req.session.firstName = user.firstName;
    req.session.lastName = user.lastName;
    req.session.specialization = user.specialization
      ? user.specialization.name
      : "Unknown";
    req.session.role = user.role;
    req.session.status = "online";

    // 🔹 Сохраняем сессию
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error("❌ Ошибка сохранения сессии:", err);
          return reject(err);
        }
        console.log("💾 Сессия сохранена:", {
          userId: req.session.userId,
          role: req.session.role,
        });
        resolve();
      });
    });

    // === Аудит ===
    await AuditLog.create({
      action: "Login",
      userId: user._id,
      timestamp: new Date(),
      ip: req.ip || req.connection.remoteAddress,
      details: `User ${user.username} logged in successfully.`,
    });

    console.log(`✅ User ${decryptedEmail} is logged in (Online)`);

    // === Ответ клиенту ===
    return res.status(200).json({
      message: "Вход выполнен успешно",
      user: {
        id: user._id,
        username: user.username,
        email: decryptedEmail,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        specialization: user.specialization
          ? user.specialization.name
          : "Unknown",
        status: "online",
        profileData: profileData || null,
      },
    });
  } catch (error) {
    console.error("❌ Authorization error:", error);
    return res.status(500).json({
      message: "Login error",
      error: error.message,
    });
  }
};
