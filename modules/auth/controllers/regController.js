import User from "../../../common/models/Auth/users.js";
import Specialization from "../../../common/models/DoctorProfile/specialityOfDoctor.js";
import argon2 from "argon2";
import "dotenv/config";
import { sendEmail } from "../../../common/services/emailService.js";
import { RateLimiterMemory } from "rate-limiter-flexible";
import crypto from "crypto";
import { tReq } from "../../../common/i18n/index.js";
// Единственный источник правды по тарифам и лимитам.
//
// Раньше здесь же импортировался common/config/subscriptions.js — второй,
// более старый конфиг подписок со своими значениями. Он расходился с
// aiPlanLimits: выдавал новому врачу maxPatients = 10 там, где пробный
// период обещает сотню. Удалён; всё берётся отсюда.
import {
  DOCTOR_TRIAL_DAYS,
  PATIENT_TRIAL_DAYS,
  PLAN_LIMITS,
  resolveEffectivePlan,
} from "../../../common/config/aiPlanLimits.js";

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
      ref, // реферальный код пригласившего (из ?ref= на фронте)
    } = req.body;

    // H-2: не логируем email/parentEmail (PII). Оставляем обезличенные метки.
    console.log("📩 Registration request received:", { role, speciality });

    // ----------- Проверка обязательных полей -----------
    if (!email || !password || !username || !role) {
      return res.status(400).json({
        message: tReq(req, "app.auth.regFieldsRequired", {}, "email, password, username и role обязательны"),
      });
    }

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

    // 🎯 Старая система — выбор стартового тарифа по роли (объект subscription)
    const defaultTier = role === "doctor" ? "doctor_free" : "patient_free";

    // features — кэш для старого кода. Собираем его из действующего плана,
    // а не из отдельной таблицы: две таблицы про одно и то же расходятся
    // молча, и именно так новый врач получал лимит в 5 пациентов при
    // пробном периоде на сотню.
    const effectivePlan = resolveEffectivePlan({
      role,
      subscriptionPlan: null,
      trialEndsAt: new Date(
        Date.now() +
          (role === "doctor" ? DOCTOR_TRIAL_DAYS : PATIENT_TRIAL_DAYS) *
            24 *
            60 *
            60 *
            1000,
      ),
    });
    const planLimits = PLAN_LIMITS[effectivePlan] || {};
    const defaultFeatures = {
      maxPatients: planLimits.patientsInOffice ?? 5,
      aiAccess: role === "doctor",
      prioritySupport: false,
      familyMembers: planLimits.familyMembers ?? 0,
    };

    // 💎 НОВАЯ СИСТЕМА — расчёт trial и плоского subscriptionPlan
    //
    // Пробный период есть у обеих ролей, по 3 месяца:
    //   врач   → doctor_trial  (лимиты Doctor Start)
    //   пациент→ patient_trial (видео как на Pro, помощник чуть выше Free)
    //
    // Раньше пациенту ставился null: «у них Free навсегда». Из-за этого
    // человек, только что зарегистрировавшийся, сразу упирался в 30 минут
    // видео и не успевал понять, зачем платформа нужна. Видео при этом
    // почти ничего не стоит — сервер свой.
    const trialDays =
      role === "doctor" ? DOCTOR_TRIAL_DAYS : PATIENT_TRIAL_DAYS;
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

    // subscriptionPlan = null означает "автоопределение" в resolveEffectivePlan
    // (возьмёт patient_free / doctor_trial / doctor_basic в зависимости от роли)
    const subscriptionPlan = null;

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
      timeCost: 3,
      memoryCost: 2 ** 16,
      parallelism: 1,
      type: argon2.argon2id,
    });

    // ----------- OTP основной email -----------
    // H-3/L-4: криптостойкий генератор вместо предсказуемого Math.random().
    const otpPassword = crypto.randomInt(100000, 1000000).toString();
    const otpExpiresAt = Date.now() + 5 * 60 * 1000;

    // ----------- OTP родителя -----------
    const parentOtp = isChild
      ? crypto.randomInt(100000, 1000000).toString()
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

      // 💎 СТАРАЯ СИСТЕМА — объект subscription (для совместимости со
      // старым кодом, который мог им пользоваться)
      subscription: {
        tier: defaultTier,
        status: "active",
        startedAt: new Date(),
      },
      features: defaultFeatures,

      // 💎 НОВАЯ СИСТЕМА v2 — плоское поле + trial
      // subscriptionPlan: null = автоопределение через resolveEffectivePlan()
      // trialEndsAt: для врачей = +180 дней, для пациентов = null
      subscriptionPlan,
      trialEndsAt,
    });

    await newUser.save();

    // ----------- Реферальная атрибуция (шаг 2) -----------
    // Неблокирующе: неверный/пустой код просто игнорируется, регистрация идёт.
    // Награда — бонус-дни trial обеим сторонам (актуально для врачей с trial).
    if (ref) {
      try {
        const BONUS_DAYS = 30;
        const BONUS_CONSULTATIONS = 5;
        const DAY = 24 * 60 * 60 * 1000;
        const code = String(ref).trim().toUpperCase();
        const referrer = await User.findOne({ referralCode: code });
        if (referrer && String(referrer._id) !== String(newUser._id)) {
          const reward = (u) => {
            // Врачам (есть trial) — продлеваем trial.
            if (u.trialEndsAt) {
              const base = Math.max(
                Date.now(),
                new Date(u.trialEndsAt).getTime(),
              );
              u.trialEndsAt = new Date(base + BONUS_DAYS * DAY);
              u.referralBonusDays = (u.referralBonusDays || 0) + BONUS_DAYS;
            }
            // Всем (в т.ч. пациентам без trial) — бонусные AI-консультации.
            u.bonusConsultations =
              (u.bonusConsultations || 0) + BONUS_CONSULTATIONS;
          };
          // приглашённый
          newUser.referredBy = referrer._id;
          reward(newUser);
          await newUser.save({ validateModifiedOnly: true });
          // пригласивший
          referrer.referralCount = (referrer.referralCount || 0) + 1;
          reward(referrer);
          await referrer.save({ validateModifiedOnly: true });
        }
      } catch (e) {
        console.warn("[referral] attribution failed:", e.message);
      }
    }

    console.log("✅ User created:", {
      username,
      role,
      trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
    });

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
    // M-3: не раскрываем внутренние детали ошибки клиенту.
    return res.status(500).json({ message: "Registration failed" });
  }
};
