// server/modules/myClinic/controllers/profileUpdatePatientController.js
import mongoose from "mongoose";
import crypto from "crypto";

import ProfilePatient from "../../../common/models/PatientProfile/patientProfile.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User from "../../../common/models/Auth/users.js";
import { uploadFile } from "../../../common/middlewares/uploadMiddleware.js";

/* ===== helpers ===== */
const sha256Lower = (s) =>
  crypto
    .createHash("sha256")
    .update(String(s || "").toLowerCase())
    .digest("hex");

const normalizeEmail = (v) => (v == null ? "" : String(v).trim().toLowerCase());

const notBlank = (v) =>
  !(v == null || (typeof v === "string" && v.trim() === ""));
const cleaned = (v) => (typeof v === "string" ? v.trim() : v);

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

const parseYearRange = (s) => {
  if (!s || typeof s !== "string") return [null, null];
  const parts = s.split("-").map((y) => parseInt(String(y).trim(), 10));
  if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1]))
    return [null, null];
  return parts;
};

const normalizePreferredLanguage = (v) => {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  const map = {
    en: "en",
    eng: "en",
    english: "en",
    ru: "ru",
    rus: "ru",
    russian: "ru",
    рус: "ru",
    русский: "ru",
    az: "az",
    aze: "az",
    azerbaijani: "az",
    azərbaycan: "az",
    tr: "tr",
    tur: "tr",
    turkish: "tr",
    türkçe: "tr",
  };
  return map[s] || (["en", "ru", "az", "tr"].includes(s) ? s : undefined);
};

const generatePatientId = () =>
  `PA-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, "0")}`;

/* ===== controller ===== */
const profileUpdatePatientController = async (req, res) => {
  try {
    // --- аутентификация ---
    const rawUserId = req.user?._id || req.session?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(rawUserId)) {
      return res
        .status(403)
        .json({ message: "Пожалуйста, войдите в систему." });
    }
    const userId = new mongoose.Types.ObjectId(rawUserId);

    // --- входные данные (БЕЗ phoneNumber) ---
    const {
      company,
      job,
      speciality,
      address,
      everyoneEmail,
      about,
      educationInstitution,
      educationYears,
      specializationInstitution,
      specializationYears,
      preferredLanguage,
      country,
      // «раздельные» поля лет
      educationStartYear: eduStartSeparate,
      educationEndYear: eduEndSeparate,
      specializationStartYear: specStartSeparate,
      specializationEndYear: specEndSeparate,
      identityDocument,
    } = req.body || {};

    let [educationStartYear, educationEndYear] = parseYearRange(educationYears);
    let [specializationStartYear, specializationEndYear] =
      parseYearRange(specializationYears);

    const eduStartSep = toInt(eduStartSeparate);
    const eduEndSep = toInt(eduEndSeparate);
    const specStartSep = toInt(specStartSeparate);
    const specEndSep = toInt(specEndSeparate);

    if (eduStartSep != null) educationStartYear = eduStartSep;
    if (eduEndSep != null) educationEndYear = eduEndSep;
    if (specStartSep != null) specializationStartYear = specStartSep;
    if (specEndSep != null) specializationEndYear = specEndSep;

    // 🔥 Загружаем фото пациента в Cloudflare R2
    let imageUrl = null;

    if (req.file) {
      try {
        imageUrl = await uploadFile(req.file); // кладёт в R2
      } catch (err) {
        console.error("❌ Ошибка загрузки фото пациента в R2:", err);
      }
    }

    // 🔥 fallback фото из R2 — как у докторов
    const DEFAULT_PATIENT_PHOTO = `${process.env.R2_PUBLIC_URL}/uploads/default/default-patient-man.jpg`;

    // --- профиль пациента (social/content) ---
    let patientProfile = await ProfilePatient.findOne({ userId });

    // уникальность email/identityDocument в ProfilePatient для чужих
    const emailNorm = normalizeEmail(everyoneEmail);
    if (notBlank(everyoneEmail)) {
      const emailDup = await ProfilePatient.findOne({
        everyoneEmail: emailNorm,
        userId: { $ne: userId },
      }).lean();
      if (emailDup) {
        return res.status(409).json({
          message: "E-mail уже используется.",
          field: "everyoneEmail",
          value: emailNorm,
        });
      }
    }

    const idDocNorm = notBlank(identityDocument)
      ? String(identityDocument).trim()
      : "";
    if (idDocNorm) {
      const idDup = await ProfilePatient.findOne({
        identityDocument: idDocNorm,
        userId: { $ne: userId },
      }).lean();
      if (idDup) {
        return res.status(409).json({
          message: "Документ уже используется.",
          field: "identityDocument",
          value: idDocNorm,
        });
      }
    }

    // создать/обновить ProfilePatient
    if (!patientProfile) {
      const doc = { userId };
      if (notBlank(company)) doc.company = cleaned(company);
      if (notBlank(job)) doc.job = cleaned(job);
      if (notBlank(speciality)) doc.speciality = cleaned(speciality);
      if (notBlank(address)) doc.address = cleaned(address);
      if (notBlank(everyoneEmail)) doc.everyoneEmail = emailNorm;
      if (idDocNorm) doc.identityDocument = idDocNorm;
      if (notBlank(about)) doc.about = cleaned(about);
      if (notBlank(educationInstitution))
        doc.educationInstitution = cleaned(educationInstitution);
      if (educationStartYear != null && educationEndYear != null) {
        doc.educationStartYear = educationStartYear;
        doc.educationEndYear = educationEndYear;
      }
      if (notBlank(specializationInstitution))
        doc.specializationInstitution = cleaned(specializationInstitution);
      if (specializationStartYear != null && specializationEndYear != null) {
        doc.specializationStartYear = specializationStartYear;
        doc.specializationEndYear = specializationEndYear;
      }
      doc.photo = imageUrl || DEFAULT_PATIENT_PHOTO;

      patientProfile = new ProfilePatient(doc);
      await patientProfile.save();
    } else {
      if (notBlank(company)) patientProfile.company = cleaned(company);
      if (notBlank(job)) patientProfile.job = cleaned(job);
      if (notBlank(speciality)) patientProfile.speciality = cleaned(speciality);
      if (notBlank(address)) patientProfile.address = cleaned(address);
      if (notBlank(everyoneEmail)) patientProfile.everyoneEmail = emailNorm;
      if (idDocNorm) patientProfile.identityDocument = idDocNorm;
      if (notBlank(about)) patientProfile.about = cleaned(about);
      if (notBlank(educationInstitution))
        patientProfile.educationInstitution = cleaned(educationInstitution);
      if (educationStartYear != null && educationEndYear != null) {
        patientProfile.educationStartYear = educationStartYear;
        patientProfile.educationEndYear = educationEndYear;
      }
      if (notBlank(specializationInstitution)) {
        patientProfile.specializationInstitution = cleaned(
          specializationInstitution
        );
      }
      if (specializationStartYear != null && specializationEndYear != null) {
        patientProfile.specializationStartYear = specializationStartYear;
        patientProfile.specializationEndYear = specializationEndYear;
      }
      if (imageUrl) {
        patientProfile.photo = imageUrl;
      }

      await patientProfile.save();
    }

    // --- при необходимости: авто-создание карточки клиники (без телефона) ---
    if (process.env.AUTO_CREATE_NPC_ON_PROFILE_UPDATE === "1") {
      const existingCard = await NewPatientPolyclinic.findOne({
        linkedUserId: userId,
      }).lean();
      if (!existingCard) {
        const userDoc = await User.findById(userId); // нужен mongoose-документ
        let emailPlain = null;
        try {
          emailPlain = userDoc?.decryptFields?.().email ?? null;
        } catch {
          emailPlain = null;
        }
        if (!emailPlain && userDoc?.email) emailPlain = String(userDoc.email);

        const birthDate = userDoc?.dateOfBirth
          ? new Date(userDoc.dateOfBirth)
          : null;

        if (!idDocNorm || !birthDate || !emailPlain) {
          console.log(
            "ℹ️ Пропущено авто-создание NewPatientPolyclinic (не хватает полей)",
            {
              hasIdentityDocument: Boolean(idDocNorm),
              hasBirthDate: Boolean(birthDate),
              hasEmail: Boolean(emailPlain),
            }
          );
        } else {
          try {
            const payload = {
              patientId: generatePatientId(),
              linkedUserId: userId,
              doctorId: [],
              identityDocument: idDocNorm,
              email: emailPlain, // virtual → зашифрует и поставит hash
              birthDate,
              country: notBlank(country) ? cleaned(country) : undefined,
              bio: notBlank(about) ? cleaned(about) : "",
              firstName: userDoc?.firstName || undefined,
              lastName: userDoc?.lastName || undefined,
            };
            const doc = new NewPatientPolyclinic(payload);
            doc.$locals = { allowCreate: true };
            await doc.save();
            console.log("✅ Создана карточка NewPatientPolyclinic", {
              userId: String(userId),
            });
          } catch (e) {
            if (e?.code === 11000) {
              console.warn(
                "⚠️ Конфликт уникальности при создании NewPatientPolyclinic:",
                e?.keyValue
              );
            } else {
              console.error("❌ Ошибка при создании NewPatientPolyclinic:", e);
            }
          }
        }
      }
    }

    // --- User.preferredLanguage / country ---
    const userUpdate = {};
    if (typeof preferredLanguage !== "undefined") {
      const lang = normalizePreferredLanguage(preferredLanguage);
      if (!lang) {
        return res.status(400).json({
          message:
            "Некорректное значение preferredLanguage. Допустимо: en, ru, az, tr.",
          field: "preferredLanguage",
          value: preferredLanguage,
        });
      }
      userUpdate.preferredLanguage = lang;
    }
    if (notBlank(country)) userUpdate.country = cleaned(country);

    if (Object.keys(userUpdate).length > 0) {
      await User.findByIdAndUpdate(
        userId,
        { $set: userUpdate },
        { new: false, runValidators: true, context: "query" }
      );
    }

    return res.status(200).json({
      message: "✅ Профиль сохранён.",
    });
  } catch (error) {
    console.error("❌ Ошибка при обновлении профиля:", error);
    if (error?.code === 11000 && error?.keyPattern) {
      const field = Object.keys(error.keyPattern || {})[0] || "unknown";
      const map = {
        identityDocument: "Документ уже используется.",
        everyoneEmail: "E-mail уже используется.",
      };
      return res.status(409).json({
        message: map[field] || "Конфликт уникальности.",
        field,
        value: error?.keyValue?.[field],
      });
    }
    return res.status(500).json({ message: "Ошибка при обновлении профиля." });
  }
};

export default profileUpdatePatientController;
