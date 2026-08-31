import crypto from "crypto";
import dotenv from "dotenv";
import User from "../../../common/models/users.js";
import NewPatientPolyclinic from "../../../common/models/newPatientPolyclinic.js";

dotenv.config();

// Функция шифрования данных для поиска
const encrypt = (text) => {
  if (!text || text.includes(":")) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(process.env.ENCRYPTION_KEY.padEnd(32, "0")),
    iv
  );
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
};

// Контроллер автозаполнения
const patientAutocompleteController = async (req, res) => {
  try {
    if (!req.session.userId) {
      return res
        .status(403)
        .json({ message: req.t("myClinic.auth.pleaseLogin") });
    }

    const { query } = req.query;
    if (!query?.trim()) {
      return res.status(400).json({ message: req.t("myClinic.search.enterSearchData") });
    }

    console.log("🔍 Выполняем поиск:", query);

    // Шифруем введенные данные для поиска
    const encryptedQuery = encrypt(query.trim());

    // Ищем пациентов по всем возможным полям
    const patients = await NewPatientPolyclinic.find({
      $or: [
        { patientId: query.trim() },
        { patientUUID: query.trim() },
        { fullName: encryptedQuery },
        { email: encryptedQuery },
        { phoneNumber: encryptedQuery },
        { identityDocument: encryptedQuery },
      ],
    }).limit(10); // Ограничиваем количество результатов

    if (patients.length > 0) {
      return res.status(200).json({ found: true, patients });
    }

    return res
      .status(200)
      .json({ found: false, message: req.t("myClinic.patient.noPatientsFound") });
  } catch (error) {
    console.error("❌ Ошибка при поиске пациента:", error);
    res.status(500).json({ message: req.t("myClinic.patient.searchError") });
  }
};

export default patientAutocompleteController;
