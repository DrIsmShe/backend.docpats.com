// server/modules/myClinic/controllers/profileMainUpdatePatientController.js
import mongoose from "mongoose";
import crypto from "crypto";
import User from "../../../common/models/Auth/users.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

/* helpers */
const cleanStr = (v) => (v == null ? undefined : String(v).trim());
const isBlank = (v) => v == null || String(v).trim() === "";

const parseDate = (v) => {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const normalizePhone = (s = "") => {
  const raw = String(s || "");
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d+]/g, "");
  const withPlus = cleaned.startsWith("+")
    ? cleaned
    : `+${cleaned.replace(/^(\+)?/, "")}`;
  return /^\+\d{1,15}$/.test(withPlus) ? withPlus : "";
};

const sha256Lower = (s) =>
  crypto
    .createHash("sha256")
    .update(String(s || "").toLowerCase())
    .digest("hex");

const normalizeGenderForModels = (v) => {
  if (v == null) return { genderNorm: undefined, bioText: undefined };
  const s = String(v).trim().toLowerCase();
  if (!s) return { genderNorm: undefined, bioText: undefined };

  const male = new Set([
    "m",
    "male",
    "man",
    "м",
    "муж",
    "мужчина",
    "erkek",
    "kişi",
    "kisi",
  ]);
  const female = new Set([
    "f",
    "female",
    "woman",
    "ж",
    "жен",
    "женщина",
    "kadin",
    "kadın",
    "qadin",
    "qadın",
  ]);

  if (male.has(s)) return { genderNorm: "male", bioText: "Man" };
  if (female.has(s)) return { genderNorm: "female", bioText: "Woman" };

  const nice = s.charAt(0).toUpperCase() + s.slice(1);
  return { genderNorm: "other", bioText: nice };
};

/* controller */
const profileMainUpdatePatientController = async (req, res) => {
  try {
    const { userId, avatar, username, dateOfBirth, bio, phoneNumber } =
      req.body || {};

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ message: "Некорректный формат ID пользователя." });
    }

    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ message: "Пользователь не найден." });

    if (!isBlank(username) && !/^[a-zA-Z0-9_-]{3,20}$/.test(String(username))) {
      return res.status(400).json({
        message:
          "Username может содержать только буквы, цифры, '-', '_', длиной 3–20 символов.",
      });
    }

    // Дата рождения
    let dob;
    if (dateOfBirth != null) {
      dob = parseDate(dateOfBirth);
      if (!dob)
        return res.status(400).json({ message: "Некорректная дата рождения." });
    }

    // Гендер -> users.bio (читаемо) и NPC.gender/NPC.bio
    const { genderNorm, bioText } = normalizeGenderForModels(bio);
    if (bioText && bioText.length > 500) {
      return res
        .status(400)
        .json({ message: "Bio не должно превышать 500 символов." });
    }

    // Телефон
    let normalizedPhone = undefined;
    let phoneHash = undefined;
    let clearPhone = false;

    if (phoneNumber !== undefined) {
      const trimmed = String(phoneNumber || "").trim();
      if (trimmed === "") {
        clearPhone = true;
      } else {
        normalizedPhone = normalizePhone(trimmed);
        if (!normalizedPhone) {
          return res
            .status(400)
            .json({ message: "Некорректный номер телефона." });
        }
        phoneHash = sha256Lower(normalizedPhone);
      }
    }

    /* --- апдейт User (имя/фамилию НЕ трогаем) --- */
    const userUpdate = {};
    const av = cleanStr(avatar);
    const un = cleanStr(username);

    if (av) userUpdate.avatar = av;
    if (un) userUpdate.username = un;
    if (dob) userUpdate.dateOfBirth = dob;
    if (!isBlank(bioText)) userUpdate.bio = bioText;

    const updatedUser =
      Object.keys(userUpdate).length > 0
        ? await User.findByIdAndUpdate(
            userId,
            { $set: userUpdate },
            { new: true, runValidators: true, context: "query" }
          )
        : await User.findById(userId);

    /* --- апдейт клинической карточки (без создания) --- */
    const card = await NewPatientPolyclinic.findOne({
      linkedUserId: userId,
    }).lean();
    if (!card) {
      return res.status(409).json({
        message:
          "Карточка пациента в клинике не найдена. Сначала зарегистрируйтесь в клинике.",
      });
    }

    // проверка дублей телефона
    if (!clearPhone && phoneHash) {
      const dupe = await NewPatientPolyclinic.findOne({
        phoneHash,
        _id: { $ne: card._id },
      })
        .select("_id")
        .lean();
      if (dupe) {
        return res.status(409).json({
          message: "Телефон уже используется другой картой пациента.",
        });
      }
    }

    const $set = {};
    const $unset = {};

    if (dob) $set.birthDate = dob; // Date of Birth → в NPC
    if (!isBlank(bioText)) $set.bio = bioText; // читабельный текст
    if (genderNorm) $set.gender = genderNorm; // нормализованный пол (нужен field в схеме!)

    if (phoneNumber !== undefined) {
      if (clearPhone) {
        $unset.phoneEncrypted = "";
        $unset.phoneHash = "";
      } else {
        $set.phoneEncrypted = normalizedPhone; // триггерит нормализатор/шифрование/хэш
      }
    }

    const updatedPatient = await NewPatientPolyclinic.findOneAndUpdate(
      { _id: card._id },
      Object.keys($unset).length ? { $set, $unset } : { $set },
      { new: true, runValidators: true, context: "query", upsert: false }
    ).lean({ getters: true, virtuals: true });

    return res.status(200).json({
      message: "Профиль успешно обновлён",
      user: updatedUser || null,
      patient: updatedPatient || null,
    });
  } catch (error) {
    console.error("Ошибка обновления профиля:", error);
    if (error?.code === 11000 && error?.keyPattern) {
      const field = Object.keys(error.keyPattern || {})[0] || "unknown";
      const map = {
        emailHash: "E-mail уже используется.",
        emailEncrypted: "E-mail уже используется.",
        phoneHash: "Телефон уже используется.",
        phoneEncrypted: "Телефон уже используется.",
        identityDocument: "Документ уже используется.",
        patientId: "Идентификатор пациента уже используется, повторите запрос.",
      };
      return res
        .status(409)
        .json({ message: map[field] || "Конфликт уникальности." });
    }
    return res
      .status(500)
      .json({ message: "Ошибка на сервере", error: error.message });
  }
};

export default profileMainUpdatePatientController;
