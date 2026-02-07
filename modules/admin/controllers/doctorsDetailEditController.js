import mongoose from "mongoose";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

/**
 * PATCH /admin/doctor-detail-edit/:doctorId[?by=user]
 * ------------------------------------------------------
 *  - Если ?by=user → doctorId = userId, ищет/создаёт профиль по userId.
 *  - Если без ?by=user → doctorId = _id профиля.
 *  - Возвращает полный объект профиля (со всеми полями модели).
 */
export const doctorsDetailEditController = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const findByUser = String(req.query.by || "").toLowerCase() === "user";

    console.log("🔹 PATCH /doctor-detail-edit:", {
      doctorId,
      findByUser,
      body: req.body,
    });

    /* 🧩 Проверка корректности ID */
    if (!mongoose.isValidObjectId(doctorId)) {
      return res
        .status(400)
        .json({ ok: false, message: "Некорректный идентификатор врача." });
    }

    /* 🧠 Определяем роль */
    const requesterRole = req.userRole || "user";
    const isAdmin = requesterRole === "admin";

    /* 🔐 Разрешённые поля */
    const ALLOWED_FIELDS_COMMON = [
      "company",
      "address",
      "clinic",
      "about",
      "country",
      "educationInstitution",
      "educationStartYear",
      "educationEndYear",
      "specializationInstitution",
      "specializationStartYear",
      "specializationEndYear",
      "phoneNumber", // ✅ телефон
    ];
    const ALLOWED_FIELDS_ADMIN = ["isVerified", "verificationDocuments"];
    const allowedFields = new Set([
      ...ALLOWED_FIELDS_COMMON,
      ...(isAdmin ? ALLOWED_FIELDS_ADMIN : []),
    ]);

    /* 🧾 Формируем update */
    const src = req.body || {};
    const update = {};
    for (const [key, value] of Object.entries(src)) {
      if (!allowedFields.has(key)) continue;
      if (Array.isArray(value)) update[key] = value;
      else if (typeof value === "string") update[key] = value.trim();
      else update[key] = value;
    }

    /* 📆 Годы → число */
    const YEAR_KEYS = [
      "educationStartYear",
      "educationEndYear",
      "specializationStartYear",
      "specializationEndYear",
    ];
    for (const key of YEAR_KEYS) {
      if (key in update) {
        const raw = update[key];
        if (!raw) update[key] = null;
        else {
          const n = Number(String(raw).slice(0, 4));
          update[key] = Number.isFinite(n) ? n : null;
        }
      }
    }

    /* ======================== 🔍 Поиск / создание профиля ======================== */
    let profile;
    if (findByUser) {
      // doctorId — это userId
      profile = await ProfileDoctor.findOne({ userId: doctorId });

      if (!profile) {
        console.log("🆕 Создаём новый профиль врача для userId =", doctorId);
        profile = new ProfileDoctor({
          userId: doctorId,
          clinic: update.clinic || "—",
        });
      }
    } else {
      // doctorId — это _id профиля
      profile = await ProfileDoctor.findById(doctorId);
      if (!profile) {
        return res
          .status(404)
          .json({ ok: false, message: "Профиль врача не найден." });
      }
    }

    /* ✏️ Присваиваем новые данные */
    for (const [key, value] of Object.entries(update)) {
      if (key === "clinic" && (!value || value === "")) continue;

      // ✅ Автокоррекция формата телефона
      if (key === "phoneNumber") {
        let phone = String(value || "").trim();

        // Если пользователь случайно удалил “+” → добавляем
        if (phone && !phone.startsWith("+")) {
          phone = "+" + phone.replace(/[^\d]/g, "");
        }

        // Если слишком короткий номер (только код), добавляем шаблон
        if (phone.startsWith("+") && phone.length < 8) {
          phone = phone + "0000000";
        }

        profile.phoneNumber = phone;
        continue;
      }

      profile[key] = value === "" ? null : value;
    }

    /* 💾 Сохраняем */
    await profile.save();

    // 🔄 Получаем полный объект с расшифровкой телефона
    const populatedProfile = await ProfileDoctor.findById(profile._id)
      .populate("userId", "firstNameEncrypted lastNameEncrypted email role")
      .populate("recommendations", "_id firstNameEncrypted lastNameEncrypted")
      .lean();

    // ✅ Добавляем явное поле phoneNumber, даже если модель его шифрует
    if (profile.phoneNumber) {
      populatedProfile.phoneNumber = profile.phoneNumber;
    }

    return res.status(200).json({
      ok: true,
      message: profile.isNew
        ? "Профиль врача успешно создан."
        : "Профиль врача успешно обновлён.",
      profile: populatedProfile,
    });
  } catch (err) {
    console.error("❌ admin/doctorsDetailEditController error:", err);

    /* ⚠️ Ошибка уникальности телефона */
    if (err?.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Такой номер телефона уже используется.",
        code: "PHONE_ALREADY_EXISTS",
      });
    }

    /* ⚠️ Ошибки Mongoose валидации */
    if (err?.name === "ValidationError" || err?.name === "ValidatorError") {
      const details = Object.fromEntries(
        Object.entries(err.errors || {}).map(([k, v]) => [
          k,
          v?.message || "Invalid value",
        ])
      );
      return res.status(400).json({
        ok: false,
        message: "Ошибка валидации данных профиля.",
        details,
      });
    }

    /* ⚠️ Любая другая ошибка */
    return res.status(500).json({
      ok: false,
      message: "Внутренняя ошибка сервера при обновлении профиля врача.",
    });
  }
};

export default doctorsDetailEditController;
