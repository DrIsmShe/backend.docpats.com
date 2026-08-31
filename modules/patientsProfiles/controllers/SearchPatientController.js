import crypto from "crypto";
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../../../common/models/Auth/users.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

dotenv.config();

const SECRET_KEY = process.env.ENCRYPTION_KEY?.padEnd(32, "0");
if (!SECRET_KEY || SECRET_KEY.length !== 32) {
  throw new Error(req.t("app.config.encryptionKeyInvalid"));
}

// 🔐 Функции шифрования и дешифрования
const encrypt = (text) => {
  if (!text || text.includes(":")) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    iv
  );
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
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
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("❌ Ошибка расшифровки:", error.message);
    return null;
  }
};

// 🔍 Контроллер поиска пациента
const patientSearchPolyclinicController = async (req, res) => {
  try {
    if (!req.session.userId) {
      return res
        .status(403)
        .json({ message: req.t("app.auth.pleaseLogin") });
    }

    const { query } = req.query;
    if (!query?.trim()) {
      return res
        .status(400)
        .json({ message: req.t("app.validation.searchCriteriaMissing") });
    }

    console.log(`🔍 Поиск пациента по запросу: ${query}`);

    let foundPatient = await NewPatientPolyclinic.findOne({
      $or: [
        { emailEncrypted: encrypt(query) },
        { phoneEncrypted: encrypt(query) },
        { patientId: query },
        { patientUUID: query },
      ],
    });

    if (foundPatient) {
      console.log("✅ Пациент найден в `NewPatientPolyclinic`");

      if (!foundPatient.doctorId.includes(req.session.userId)) {
        foundPatient.doctorId.push(req.session.userId);
        await foundPatient.save();
      }

      return res.status(200).json({
        found: true,
        message: req.t("app.patient.foundAndLinked"),
        patient: {
          ...foundPatient.toObject(),
          email: decrypt(foundPatient.emailEncrypted),
          phoneNumber: decrypt(foundPatient.phoneEncrypted),
          identityDocument: decrypt(foundPatient.identityDocument),
        },
      });
    }

    console.log("🔍 Пациент не найден в клинике, ищем в `Users`...");
    let existingUser = await User.findOne({
      $or: [
        { emailEncrypted: encrypt(query) },
        { phoneEncrypted: encrypt(query) },
      ],
    });

    if (existingUser) {
      console.log(
        "✅ Пациент найден в `Users`, создаём запись в `NewPatientPolyclinic`..."
      );

      const newPatientUUID = new mongoose.Types.ObjectId();

      const newPatient = new NewPatientPolyclinic({
        patientUUID: newPatientUUID,
        linkedUserId: existingUser._id,
        patientId: `PA${Math.floor(100000 + Math.random() * 900000)}`,
        firstName: decrypt(existingUser.firstNameEncrypted),
        lastName: decrypt(existingUser.lastNameEncrypted),
        gender: "Неизвестно",
        birthDate: "Неизвестно",
        phoneEncrypted: existingUser.phoneEncrypted,
        emailEncrypted: existingUser.emailEncrypted,
        identityDocument: encrypt(query),
        doctorId: [req.session.userId],
        chronicDiseases: "Неизвестно",
        operations: "Неизвестно",
        familyHistoryOfDisease: "Неизвестно",
        allergies: "Неизвестно",
        immunization: "Неизвестно",
        badHabits: "Неизвестно",
      });

      await newPatient.save();

      return res.status(201).json({
        found: true,
        message: req.t("app.patient.foundAndAddedToClinic"),
        patient: {
          ...newPatient.toObject(),
          email: decrypt(newPatient.emailEncrypted),
          phoneNumber: decrypt(newPatient.phoneEncrypted),
          identityDocument: decrypt(newPatient.identityDocument),
        },
      });
    }

    console.log("❌ Пациент не найден.");
    return res
      .status(404)
      .json({ found: false, message: req.t("app.patient.notFound2") });
  } catch (error) {
    console.error("❌ Ошибка при поиске пациента:", error);
    res.status(500).json({ message: req.t("app.patient.searchError") });
  }
};

export default patientSearchPolyclinicController;
