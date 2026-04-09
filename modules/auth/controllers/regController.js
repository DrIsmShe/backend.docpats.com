import User from "../../../common/models/Auth/users.js";
import Specialization from "../../../common/models/DoctorProfile/specialityOfDoctor.js";
import argon2 from "argon2";
import "dotenv/config";
import { sendEmail } from "../../../common/services/emailService.js";
import { RateLimiterMemory } from "rate-limiter-flexible";
import crypto from "crypto";
import { SUBSCRIPTION_PRESETS } from "../../../common/config/subscriptions.js";

// ---------- utils ----------
const safeLower = (v) => (typeof v === "string" ? v.toLowerCase() : "");
const hashData = (data) =>
  crypto.createHash("sha256").update(safeLower(data)).digest("hex");

// Защита от пустого ENCRYPTION_KEY
const SECRET_KEY = (process.env.ENCRYPTION_KEY || "")
  .padEnd(32, "0")
  .slice(0, 32);

// Шифрование
const encrypt = (text) => {
  if (!text || typeof text !== "string" || text.includes(":")) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    iv,
  );
  let encrypted = cipher.update(text, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
};

// Лимитер
const rateLimiter = new RateLimiterMemory({ points: 5, duration: 600 });

// ---------- controller ----------
export const registerUser = async (req, res) => {
  try {
    const {
      email,
      password,
      username,
      firstName,
      lastName,
      role,
      speciality,
      agreement,
      bio,
      dateOfBirth,
      parentEmail,
    } = req.body;

    console.log("📩 Registration request received:", {
      email,
      username,
      role,
      speciality,
      parentEmail,
    });

    // ----------- Проверка обязательных полей -----------
    if (!email || !password || !username || !role) {
      return res.status(400).json({
        message: "email, password, username и role обязательны",
      });
    }

    // agreement должно быть строго true
    if (agreement !== true) {
      return res.status(400).json({
        message: "Agreement must be accepted.",
      });
    }

    if (!bio || typeof bio !== "string") {
      return res.status(400).json({
        message: "Bio (gender) is required.",
      });
    }

    if (!dateOfBirth) {
      return res.status(400).json({
        message: "Date of birth is required.",
      });
    }

    // ----------- Ограничение по IP -----------
    try {
      const ip = req.ip || req.connection?.remoteAddress || "unknown";
      await rateLimiter.consume(ip);
    } catch {
      return res.status(429).json({
        message: "Too many requests. Try later.",
      });
    }

    // ----------- Возрастная логика -----------
    const dob = new Date(dateOfBirth);
    const today = new Date();

    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }

    const isChild = role === "patient" && age < 18;
    // 🎯 Выбор стартового тарифа по роли
    const defaultTier = role === "doctor" ? "doctor_free" : "patient_free";

    // 🎯 Фичи по тарифу
    const defaultFeatures = SUBSCRIPTION_PRESETS[defaultTier];

    if (isChild && !parentEmail) {
      return res.status(400).json({
        message: "Parent email is required for patients under 18.",
      });
    }

    // ----------- Поиск специализации (для doctor) -----------
    let specializationId = null;
    if (speciality) {
      const specialization = await Specialization.findOne({ name: speciality });
      if (!specialization) {
        return res.status(400).json({
          message: "Specialization not found",
        });
      }
      specializationId = specialization._id;
      console.log("🩺 Specialization found:", specialization.name);
    }

    // ----------- Хеши & шифрование -----------
    const emailHash = hashData(email);
    const firstNameHash = hashData(firstName);
    const lastNameHash = hashData(lastName);

    const emailEncrypted = encrypt(email);
    const firstNameEncrypted = encrypt(firstName);
    const lastNameEncrypted = encrypt(lastName);

    // ----------- Проверка уникальности пользователя -----------
    const existingUser = await User.findOne({
      $or: [{ emailHash }, { username }],
    });

    if (existingUser) {
      return res.status(400).json({
        message: "User with this email or username already exists.",
      });
    }

    // ----------- Хэш пароля -----------
    const hashedPassword = await argon2.hash(password, {
      timeCost: 2,
      memoryCost: 2 ** 16,
      parallelism: 1,
    });

    // ----------- OTP основной email -----------
    const otpPassword = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = Date.now() + 5 * 60 * 1000;

    // ----------- OTP родителя -----------
    const parentOtp = isChild
      ? Math.floor(100000 + Math.random() * 900000).toString()
      : null;

    const parentOtpExpires = isChild ? Date.now() + 10 * 60 * 1000 : null;

    // ----------- Создание пользователя -----------
    const newUser = new User({
      email,
      firstName,
      lastName,
      specialization: specializationId,

      emailHash,
      firstNameHash,
      lastNameHash,

      emailEncrypted,
      firstNameEncrypted,
      lastNameEncrypted,

      password: hashedPassword,
      username,
      role,
      bio,
      dateOfBirth,
      agreement,

      otpPassword,
      otpExpiresAt,

      isDoctor: role === "doctor",
      isPatient: role === "patient",

      // Новые поля для детей
      isChild,
      childStatus: isChild ? "waitingParent" : "active",
      parentEmail: parentEmail || null,
      parentOtp,
      parentOtpExpires,
      // 💎 ПОДПИСКА (FREE по умолчанию)
      subscription: {
        tier: defaultTier,
        status: "active",
        startedAt: new Date(),
      },

      // 💎 ФИЧИ ПО ТАРИФУ
      features: defaultFeatures,
    });

    await newUser.save();

    // ----------- Отправка OTP пользователю -----------
    await sendEmail(email, "Your OTP Code", `Your OTP code is: ${otpPassword}`);

    // ----------- Отправка OTP родителю -----------
    if (isChild && parentEmail) {
      await sendEmail(
        parentEmail,
        "Confirm your child's account",
        `Your parent confirmation code: ${parentOtp}`,
      );
    }

    console.log("✅ User created and OTP emails sent");

    return res.status(201).json({
      message: isChild
        ? "Child account created. Parent confirmation required."
        : "User created successfully. OTP sent to your email.",
    });
  } catch (error) {
    console.error("❌ Error during registration:", error);
    return res.status(500).json({
      message: "Registration failed",
      error: error.message,
    });
  }
};
