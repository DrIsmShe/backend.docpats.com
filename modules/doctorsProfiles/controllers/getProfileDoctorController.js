// controllers/doctor/getProfileDoctorController.js
import mongoose from "mongoose";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import User from "../../../common/models/Auth/users.js";
import crypto from "crypto";
import dotenv from "dotenv";
import { decryptPhone } from "../../../common/middlewares/cryptoPhone.js";

dotenv.config();

/* ======================================================
   🔐 Константа шифрования AES-256-CBC (32 байта)
   ====================================================== */
const SECRET_KEY = (process.env.ENCRYPTION_KEY || "")
  .padEnd(32, "0")
  .slice(0, 32);
if (!SECRET_KEY || SECRET_KEY.length !== 32) {
  throw new Error("❌ ENCRYPTION_KEY is missing or invalid (must be 32 bytes)");
}

/* ======================================================
   🔓 Универсальная функция расшифровки
   Поддерживает форматы: iv:ct (hex) и iv.salt.ct (base64)
   ====================================================== */
const decryptAny = (cipherText) => {
  if (!cipherText || typeof cipherText !== "string") return null;
  try {
    let iv, ct;

    if (cipherText.includes(":")) {
      // hex формат: iv:ct
      const [ivHex, ctHex] = cipherText.split(":");
      iv = Buffer.from(ivHex, "hex");
      ct = Buffer.from(ctHex, "hex");
    } else if (cipherText.includes(".") && cipherText.split(".").length === 3) {
      // base64 формат: iv.salt.ct
      const [ivB64, , ctB64] = cipherText.split(".");
      iv = Buffer.from(ivB64, "base64");
      ct = Buffer.from(ctB64, "base64");
    } else {
      throw new Error("Unsupported ciphertext format");
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      iv
    );
    const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (err) {
    console.warn("⚠️ Decryption failed:", err.message);
    return null;
  }
};

/* ======================================================
   👨‍⚕️ Контроллер получения профиля врача
   ====================================================== */
const getProfileDoctorController = async (req, res) => {
  try {
    const userId = req.params.userId || req.session?.userId;

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "User ID is missing" });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID format" });
    }

    /* === 1️⃣ Получаем профиль врача === */
    const doctorProfile = await ProfileDoctor.findOne({ userId })
      .select("+phoneEncrypted")
      .populate(
        "userId",
        "username emailEncrypted firstNameEncrypted lastNameEncrypted"
      )
      .lean();

    /* === 2️⃣ Если профиль не найден === */
    if (!doctorProfile) {
      console.warn(`⚠️ Doctor profile not found for userId=${userId}`);
      return res.status(200).json({
        success: true,
        profile: {
          userId,
          username: null,
          email: null,
          firstName: null,
          lastName: null,
          profileImage: "uploads/default.png",
          company: null,
          country: null,
          address: null,
          phoneNumber: null,
          about: null,
          educationInstitution: null,
          educationStartYear: null,
          educationEndYear: null,
          specializationInstitution: null,
          specializationStartYear: null,
          specializationEndYear: null,
          isEmpty: true,
        },
      });
    }

    /* === 3️⃣ Расшифровываем email, имя и фамилию === */
    const decryptedEmail = decryptAny(doctorProfile.userId?.emailEncrypted);
    const decryptedFirstName = decryptAny(
      doctorProfile.userId?.firstNameEncrypted
    );
    const decryptedLastName = decryptAny(
      doctorProfile.userId?.lastNameEncrypted
    );

    /* === 4️⃣ Расшифровываем телефон === */
    let phoneNumber = null;
    try {
      if (doctorProfile.phoneEncrypted) {
        phoneNumber = decryptPhone(doctorProfile.phoneEncrypted);
      } else if (doctorProfile.phoneNumber) {
        phoneNumber = doctorProfile.phoneNumber; // если уже расшифрован
      }
    } catch (err) {
      console.warn("⚠️ Phone decrypt error:", err.message);
    }

    /* === 5️⃣ Формируем ответ === */
    const profileResponse = {
      userId,
      username: doctorProfile.userId?.username ?? null,
      email: decryptedEmail ?? null,
      firstName: decryptedFirstName ?? null,
      lastName: decryptedLastName ?? null,
      profileImage: doctorProfile.profileImage ?? "uploads/default.png",
      company: doctorProfile.company ?? null,
      country: doctorProfile.country ?? null,
      address: doctorProfile.address ?? null,
      phoneNumber: phoneNumber ?? null,
      about: doctorProfile.about ?? null,
      educationInstitution: doctorProfile.educationInstitution ?? null,
      educationStartYear: doctorProfile.educationStartYear ?? null,
      educationEndYear: doctorProfile.educationEndYear ?? null,
      specializationInstitution:
        doctorProfile.specializationInstitution ?? null,
      specializationStartYear: doctorProfile.specializationStartYear ?? null,
      specializationEndYear: doctorProfile.specializationEndYear ?? null,
      isEmpty: false,
    };

    /* === 6️⃣ Возвращаем клиенту === */
    return res.status(200).json({ success: true, profile: profileResponse });
  } catch (error) {
    console.error("❌ getProfileDoctorController Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

export default getProfileDoctorController;
