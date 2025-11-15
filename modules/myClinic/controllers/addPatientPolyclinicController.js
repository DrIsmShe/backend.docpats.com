// ✅ clinic/controllers/addPatientPolyclinicController.js
import crypto from "crypto";
import dotenv from "dotenv";
import argon2 from "argon2";
import QRCode from "qrcode";

import PatientProfile from "../../../common/models/PatientProfile/patientProfile.js";
import User from "../../../common/models/Auth/users.js";
import { sendEmail } from "../../../common/services/emailService.js";

dotenv.config();

/* ============ helpers ============ */
// устойчивый patientId
const generatePatientId = () =>
  `PA-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, "0")}`;

const generateTempPassword = () => crypto.randomBytes(4).toString("hex");

// Хеш в нижнем регистре (для email/тел/ФИО)
const sha256Lower = (s) =>
  crypto
    .createHash("sha256")
    .update(String(s || "").toLowerCase())
    .digest("hex");

// Нормализация телефона для проверки дублей (+ и до 15 цифр)
const normalizePhoneForCheck = (s = "") => {
  const raw = String(s || "");
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d+]/g, "");
  const withPlus = cleaned.startsWith("+")
    ? cleaned
    : `+${cleaned.replace(/^(\+)?/, "")}`;
  return /^\+\d{1,15}$/.test(withPlus) ? withPlus : "";
};

// dd/mm/yyyy или yyyy-mm-dd
const toDate = (val) => {
  if (!val) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
    const [dd, mm, yyyy] = val.split("/");
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return new Date(`${val}T00:00:00.000Z`);
  }
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
};

/* --- Username sanitize + unique --- */
// Мягкая транслитерация часто встречающихся символов (AZ/TR + базовые диакритики)
const translitMap = {
  ə: "e",
  Ə: "E",
  ı: "i",
  İ: "i",
  ö: "o",
  Ö: "O",
  ü: "u",
  Ü: "U",
  ğ: "g",
  Ğ: "G",
  ş: "s",
  Ş: "S",
  ç: "c",
  Ç: "C",
  à: "a",
  á: "a",
  ä: "a",
  â: "a",
  ã: "a",
  å: "a",
  À: "A",
  Á: "A",
  Ä: "A",
  Â: "A",
  Ã: "A",
  Å: "A",
  è: "e",
  é: "e",
  ë: "e",
  ê: "e",
  È: "E",
  É: "E",
  Ë: "E",
  Ê: "E",
  ì: "i",
  í: "i",
  ï: "i",
  î: "i",
  Ì: "I",
  Í: "I",
  Ï: "I",
  Î: "I",
  ò: "o",
  ó: "o",
  ö: "o",
  ô: "o",
  õ: "o",
  Ò: "O",
  Ó: "O",
  Ö: "O",
  Ô: "O",
  Õ: "O",
  ù: "u",
  ú: "u",
  ü: "u",
  û: "u",
  Ù: "U",
  Ú: "U",
  Ü: "U",
  Û: "U",
  ñ: "n",
  Ñ: "N",
};

const sanitizeUsername = (input) => {
  const s = String(input || "").trim();
  const mapped = [...s].map((ch) => translitMap[ch] ?? ch).join("");
  const withoutCombining = mapped
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  let ascii = withoutCombining.replace(/[^a-zA-Z0-9._-]+/g, "").toLowerCase();
  ascii = ascii.replace(/^([._-])+|([._-])+$/g, "").replace(/[._-]{2,}/g, "-");
  if (ascii.length > 30) ascii = ascii.slice(0, 30);
  if (ascii.length < 3) ascii = (ascii + "123").slice(0, 3);
  return ascii;
};

const ensureUniqueUsername = async (base) => {
  let u = sanitizeUsername(base) || "user";
  let i = 0;
  while (await User.exists({ username: u })) {
    i += 1;
    const suffix = String(i);
    u = sanitizeUsername((base + suffix).slice(0, 30));
  }
  return u;
};

/* ============ controller ============ */
const addPatientPolyclinicController = async (req, res) => {
  try {
    const doctorId = req.user?.userId;
    if (!doctorId) {
      return res.status(403).json({ message: "Врач не авторизован." });
    }

    // Пол берём из bio (совместимость: gender → bio)
    const bioFromReq = (req.body?.bio ?? req.body?.gender ?? "").trim();

    const {
      email,
      phoneNumber, // сырое — модель сама зашифрует/нормализует
      identityDocument,
      firstName,
      lastName,
      birthDate,
      chronicDiseases,
      operations,
      familyHistoryOfDisease,
      allergies,
      immunization,
      badHabits,
      about,
      country,
      address,
      username: requestedUsername, // если приходит с фронта
    } = req.body;

    // Обязательные поля
    if (
      !email ||
      !firstName ||
      !lastName ||
      !bioFromReq ||
      !birthDate ||
      !identityDocument
    ) {
      return res
        .status(400)
        .json({ message: "❌ Заполните все обязательные поля." });
    }

    // Дата рождения
    const birthDateObj = toDate(birthDate);
    if (!birthDateObj) {
      return res.status(400).json({ message: "Некорректная дата рождения." });
    }

    // Превентивные проверки дублей в PatientProfile
    const emailHash = sha256Lower(email);
    if (await PatientProfile.findOne({ emailHash }).lean()) {
      return res
        .status(409)
        .json({ message: "Пациент с таким e-mail уже существует." });
    }

    const normalizedPhoneForDupCheck = normalizePhoneForCheck(phoneNumber);
    if (normalizedPhoneForDupCheck) {
      const phoneHash = sha256Lower(normalizedPhoneForDupCheck);
      if (await PatientProfile.findOne({ phoneHash }).lean()) {
        return res
          .status(409)
          .json({ message: "Пациент с таким телефоном уже существует." });
      }
    }

    if (await PatientProfile.findOne({ identityDocument }).lean()) {
      return res
        .status(409)
        .json({ message: "Пациент с таким документом уже существует." });
    }

    // ---------- USER ----------
    let user = await User.findOne({ emailHash });
    let tempPassword = null;

    if (!user) {
      // 1) собрать базовый username-кандидат
      const emailLocal = String(email).split("@")[0];
      const baseUsername =
        requestedUsername ||
        `${String(firstName || "")}${String(lastName || "")}` ||
        emailLocal ||
        "user";

      // 2) санитизировать и обеспечить уникальность
      const username = await ensureUniqueUsername(baseUsername);

      // 3) сгенерить временный пароль
      tempPassword = generateTempPassword();

      // 4) создать пользователя
      user = await new User({
        patientId: generatePatientId(),

        // сырьём — если модель сама шифрует сеттерами, она это сделает
        emailEncrypted: email,
        emailHash,

        firstNameEncrypted: firstName,
        firstNameHash: sha256Lower(firstName),
        lastNameEncrypted: lastName,
        lastNameHash: sha256Lower(lastName),

        username, // ← уже безопасный и уникальный
        password: await argon2.hash(tempPassword),

        role: "patient",
        isDoctor: false,
        isPatient: true,
        isActive: true,
        mustChangePassword: true,
        twoFactorAuth: { enabled: true },
        agreement: true,

        bio: bioFromReq, // пол

        dateOfBirth: birthDateObj,
        country,
        about,
        address: address || undefined,

        phoneEncrypted: phoneNumber || undefined,
        phoneHash: normalizedPhoneForDupCheck
          ? sha256Lower(normalizedPhoneForDupCheck)
          : undefined,

        passwordExpiresAt: new Date(Date.now() + 30 * 86400000),
        accountExpiresAt: new Date(Date.now() + 30 * 86400000),

        photo: req.file?.filename || null,
      }).save();

      // Письмо пользователю (не роняем поток при ошибке почты)
      try {
        await sendEmail(
          email,
          "Регистрация в Docpats",
          `Ваш аккаунт создан.
Логин (username): ${user.username}
E-mail: ${email}
Временный пароль: ${tempPassword}
Пожалуйста, смените пароль при первом входе.`
        );
      } catch (mailErr) {
        console.error("Email delivery failed:", mailErr);
      }
    }

    // ---------- PROFILE ----------
    const patientUUID = crypto.randomUUID();
    const qrCode = await QRCode.toDataURL(patientUUID);

    const patient = new PatientProfile({
      linkedUserId: user._id,
      doctorId: [doctorId],

      patientId: generatePatientId(),
      patientUUID,
      qrCode,

      bio: bioFromReq,
      birthDate: birthDateObj,
      identityDocument,

      // виртуалы модели сами зашифруют/нормализуют
      email,
      phoneNumber,

      chronicDiseases: chronicDiseases || undefined,
      operations: operations || undefined,
      familyHistoryOfDisease: familyHistoryOfDisease || undefined,
      allergies: allergies || undefined,
      immunization: immunization || undefined,
      badHabits: badHabits || undefined,

      about: about || undefined,
      country: country || undefined,
      address: address || undefined,
      photo: req.file?.filename || null,

      isVerified: false,
      isActive: true,
      status: "Pending",
      paymentStatus: "Pending",
    });

    // гарантированно триггерим виртуалы ФИО (encrypt + hash)
    patient.firstName = firstName;
    patient.lastName = lastName;

    // 🔒 Требование вашей схемы: разрешить создание
    patient.$locals.allowCreate = true;

    await patient.save();

    return res.status(201).json({
      message: "✅ Пациент успешно добавлен. Данные отправлены на почту.",
      patient,
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern) {
      const field = Object.keys(error.keyPattern)[0] || "unknown";
      const map = {
        emailHash: "E-mail уже используется.",
        emailEncrypted: "E-mail уже используется.",
        phoneHash: "Телефон уже используется.",
        phoneEncrypted: "Телефон уже используется.",
        identityDocument: "Документ уже используется.",
        patientId: "Идентификатор пациента уже используется, повторите запрос.",
      };
      return res.status(409).json({
        message: map[field] || "Запись с такими данными уже существует.",
      });
    }

    console.error("❌ Ошибка при добавлении пациента:", error);
    return res
      .status(500)
      .json({ message: "Ошибка сервера при добавлении пациента" });
  }
};

export default addPatientPolyclinicController;
