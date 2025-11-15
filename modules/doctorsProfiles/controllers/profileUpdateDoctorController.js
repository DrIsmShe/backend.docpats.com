// controllers/doctor/updateProfileControllerDoctor.js
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

const updateProfileControllerDoctor = async (req, res) => {
  try {
    // 1) Аутентификация
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(403).json({ message: "Please sign in." });
    }

    // 2) Входные данные
    const {
      company,
      speciality,
      address,
      phoneNumber, // строка без/с '+', модель сама нормализует
      clinic,
      about,
      country,
      twitter,
      facebook,
      instagram,
      linkedin,
      educationInstitution,
      educationYears, // "2000-2025"
      specializationInstitution,
      specializationYears, // "2005-2010"
    } = req.body || {};

    // 3) Парсинг диапазонов
    const parseRange = (rangeStr) => {
      if (!rangeStr) return { start: null, end: null };
      const parts = String(rangeStr)
        .split("-")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
      if (parts.length !== 2) return { start: null, end: null };
      const [start, end] = parts;
      return { start, end };
    };

    const { start: educationStartYear, end: educationEndYear } =
      parseRange(educationYears);
    const { start: specializationStartYear, end: specializationEndYear } =
      parseRange(specializationYears);

    // 4) Картинка (если передана multer'ом)
    const baseUrl = process.env.BASE_URL || "http://localhost:11000";
    const imageUrl = req.file
      ? `${baseUrl}/uploads/${req.file.filename}`
      : null;

    // 5) Найти/создать профиль
    let profile = await ProfileDoctor.findOne({ userId });

    if (!profile) {
      // создаём БЕЗ phoneNumber в конструкторе — чтобы виртуал не проигнорировался
      profile = new ProfileDoctor({
        userId,
        company,
        speciality,
        address,
        clinic,
        about,
        country,
        twitter,
        facebook,
        instagram,
        linkedin,
        profileImage: imageUrl || `${baseUrl}/uploads/default.png`,
        educationInstitution,
        educationStartYear,
        educationEndYear,
        specializationInstitution,
        specializationStartYear,
        specializationEndYear,
      });

      // только так сработает виртуал: нормализация → шифр → hash
      if (typeof phoneNumber !== "undefined" && phoneNumber !== "") {
        profile.phoneNumber = phoneNumber;
      }

      await profile.save();
      // возвращаем созданный профиль (toJSON скрывает зашифр. поля, добавляет виртуалы)
      return res.status(201).json({
        message: "✅ Profile created successfully.",
        profile,
      });
    }

    // 6) Обновление существующего профиля (аккуратно, без затирания пустыми значениями)
    const assignIfDefined = (obj, key, value) => {
      if (typeof value !== "undefined" && value !== null && value !== "") {
        obj[key] = value;
      }
    };

    assignIfDefined(profile, "company", company);
    assignIfDefined(profile, "speciality", speciality);
    assignIfDefined(profile, "address", address);
    assignIfDefined(profile, "clinic", clinic);
    assignIfDefined(profile, "about", about);
    assignIfDefined(profile, "country", country);
    assignIfDefined(profile, "twitter", twitter);
    assignIfDefined(profile, "facebook", facebook);
    assignIfDefined(profile, "instagram", instagram);
    assignIfDefined(profile, "linkedin", linkedin);
    assignIfDefined(profile, "educationInstitution", educationInstitution);

    if (educationStartYear !== null)
      profile.educationStartYear = educationStartYear;
    if (educationEndYear !== null) profile.educationEndYear = educationEndYear;
    if (specializationInstitution)
      profile.specializationInstitution = specializationInstitution;
    if (specializationStartYear !== null)
      profile.specializationStartYear = specializationStartYear;
    if (specializationEndYear !== null)
      profile.specializationEndYear = specializationEndYear;

    // картинку обновляем только если пришёл файл
    if (imageUrl) profile.profileImage = imageUrl;

    // телефон — ТОЛЬКО через виртуал, иначе не зашифруется
    if (typeof phoneNumber !== "undefined") {
      // можно разрешить очистку номера пустой строкой:
      if (phoneNumber === "") {
        profile.phoneNumber = ""; // виртуал положит null в шифр/хэш
      } else {
        profile.phoneNumber = phoneNumber; // виртуал: E.164 + AES + hash
      }
    }

    await profile.save();

    return res.status(200).json({
      message: "✅ Profile updated successfully.",
      profile, // вернёт phoneNumber (виртуал), без phoneEncrypted/phoneHash
    });
  } catch (err) {
    // Ошибки валидации (например, невалидный телефон) — 400
    if (err?.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    console.error("❌ Error updating profile:", err);
    return res.status(500).json({ message: "Error updating profile." });
  }
};

export default updateProfileControllerDoctor;
