// server/modules/patientsProfiles/controllers/addPatientPolyclinicController.js
import crypto from "crypto";
import dotenv from "dotenv";
import mongoose from "mongoose";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User from "../../../common/models/Auth/users.js";

dotenv.config();

/* ================= helpers ================= */

const sha256Lower = (s) =>
  crypto
    .createHash("sha256")
    .update(String(s || "").toLowerCase())
    .digest("hex");

const normalizeEmail = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();

/** Нормализация для проверки дублей: "+" + 1..15 цифр */
const normalizePhone = (s = "") => {
  const raw = String(s || "");
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d+]/g, "");
  const withPlus = cleaned.startsWith("+")
    ? cleaned
    : "+" + cleaned.replace(/^(\+)?/, "");
  return /^\+\d{1,15}$/.test(withPlus) ? withPlus : "";
};

const parseBirthDate = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  // dd/mm/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("/").map((x) => parseInt(x, 10));
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // yyyy-mm-dd или иное валидное для Date
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const generatePatientId = () =>
  `PA${Math.floor(100000 + Math.random() * 900000)}`;

const sexToBio = (v) => {
  const raw = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  if (
    ["male", "man", "m", "erkek", "kişi", "м", "муж", "мужчина"].includes(raw)
  )
    return "Man";
  if (
    ["female", "woman", "f", "kadin", "qadın", "ж", "жен", "женщина"].includes(
      raw
    )
  )
    return "Woman";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

/** Безопасно вытащить строковый инпут (включая из multipart) */
const pickStr = (obj, key) => {
  const v = obj?.[key];
  if (v == null) return "";
  // если multer положил массив значений поля — возьмём первое
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  return String(v).trim();
};

/* ================= controller ================= */

export default async function addPatientPolyclinicController(req, res) {
  try {
    /* 1) Авторизация */
    const rawUserId = req.user?._id || req.session?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(rawUserId)) {
      return res.status(403).json({ message: "Пользователь не авторизован." });
    }
    const linkedUserId = new mongoose.Types.ObjectId(rawUserId);

    const user = await User.findById(linkedUserId);
    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден." });
    }

    /* 2) Извлекаем вход (корректно работает и для JSON, и для multipart/form-data) */
    const body = req.body || {};
    const email = normalizeEmail(pickStr(body, "email"));
    const firstName = pickStr(body, "firstName");
    const lastName = pickStr(body, "lastName");
    const identityDocument = pickStr(body, "identityDocument");
    const birthDateRaw = pickStr(body, "birthDate");
    const gender = pickStr(body, "gender");

    // НЕ нормализуем телефон перед сохранением — это делает сеттер модели!
    const phoneNumberRaw = pickStr(body, "phoneNumber"); // сырая строка

    const chronicDiseases = pickStr(body, "chronicDiseases") || undefined;
    const operations = pickStr(body, "operations") || undefined;
    const familyHistoryOfDisease =
      pickStr(body, "familyHistoryOfDisease") || undefined;
    const allergies = pickStr(body, "allergies") || undefined;
    const immunization = pickStr(body, "immunization") || undefined;
    const badHabits = pickStr(body, "badHabits") || undefined;
    const about = pickStr(body, "about") || undefined;
    const country = pickStr(body, "country") || undefined;
    const address = pickStr(body, "address") || undefined;

    /* 3) Обязательные поля */
    if (
      !email ||
      !firstName ||
      !lastName ||
      !gender ||
      !birthDateRaw ||
      !identityDocument
    ) {
      return res
        .status(400)
        .json({ message: "❌ Заполните все обязательные поля." });
    }

    /* 4) Дата рождения */
    const birthDate = parseBirthDate(birthDateRaw);
    if (!birthDate) {
      return res.status(400).json({ message: "Некорректная дата рождения." });
    }

    /* 5) Проверки дублей */
    const emailHash = sha256Lower(email);
    const exists = await NewPatientPolyclinic.findOne({
      $or: [{ emailHash }, { linkedUserId }],
    }).lean();

    if (exists) {
      return res.status(409).json({
        message: "Пациент уже зарегистрирован в поликлинике.",
        patientUUID: exists.patientUUID,
      });
    }

    // Для поиска дублей — нормализуем телефон (но НЕ сохраняем в таком виде!)
    const phoneForDupCheck = normalizePhone(phoneNumberRaw);
    if (phoneForDupCheck) {
      const phoneHash = sha256Lower(phoneForDupCheck);
      const dup = await NewPatientPolyclinic.findOne({ phoneHash }).lean();
      if (dup) {
        return res
          .status(409)
          .json({ message: "Пациент с таким телефоном уже существует." });
      }
    }

    /* 6) Создание документа */
    const doc = new NewPatientPolyclinic({
      linkedUserId,
      doctorId: [],
      patientId: generatePatientId(),
      identityDocument,
      birthDate,
      country,
      chronicDiseases,
      operations,
      familyHistoryOfDisease,
      allergies,
      immunization,
      badHabits,
      about,
      address,
      bio: sexToBio(gender),
      // если у тебя multer.diskStorage — тут будет filename; при memoryStorage обычно используешь другое поле/логику
      photo: req.file?.filename || null,
      isVerified: true,
      isActive: true,
      status: "Active",
      paymentStatus: "Free",
    });

    // Триггерим виртуалы модели (они сами: normalize + encrypt + hash)
    doc.email = email; // virtual email -> emailEncrypted/emailHash
    doc.firstName = firstName; // virtual firstName -> *Encrypted/*Hash
    doc.lastName = lastName; // virtual lastName  -> *Encrypted/*Hash
    // КЛЮЧЕВОЕ: кладём СЫРОЙ телефон (как пришёл). Сеттер модели уже всё сделает.
    doc.phoneNumber = phoneNumberRaw || undefined; // virtual phoneNumber -> phoneEncrypted/phoneHash

    // Требование схемы: явное разрешение на создание
    doc.$locals = { allowCreate: true };

    await doc.save();

    /* 7) Ответ (для отладки возвращаем физическое поле шифра — не делать в проде) */
    const out = doc.toObject({ getters: true, virtuals: true });
    const rawEncrypted = doc.get("phoneEncrypted", null, { getters: false });

    return res.status(201).json({
      message: "✅ Медкарта успешно создана!",
      patientUUID: out.patientUUID,
      phoneNumber: out.phoneNumber || null, // геттер вернёт плейн
      phoneEncrypted: rawEncrypted || null, // физическое поле в БД (для проверки)
      phoneHash: doc.phoneHash || null,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const field = Object.keys(error?.keyPattern || {})[0] || "unknown";
      return res.status(409).json({ message: "Конфликт уникальности.", field });
    }
    console.error("❌ Ошибка при создании медкарты:", error);
    return res
      .status(500)
      .json({ message: "Ошибка сервера при добавлении пациента." });
  }
}
