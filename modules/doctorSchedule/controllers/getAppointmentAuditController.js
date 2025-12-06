import crypto from "crypto";
import AppointmentAudit from "../../../common/models/Appointment/appointmentAudit.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User from "../../../common/models/Auth/users.js"; // нужен только чтобы корректно populate-нуть byUserId по ref:"User"

// --- локальные помощники (совместимы с вашей моделью пациента) ---
const RAW_KEY = process.env.ENCRYPTION_KEY || "default_secret_key";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);
const isIvCipher = (s) =>
  typeof s === "string" && /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/.test(s);

const decryptSafe = (cipherText) => {
  if (!cipherText) return "";
  if (!isIvCipher(cipherText)) return String(cipherText);
  try {
    const [ivHex, dataHex] = String(cipherText).split(":");
    const iv = Buffer.from(ivHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      iv
    );
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
};

const calcAge = (birthDate) => {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const n = new Date();
  let age = n.getFullYear() - b.getFullYear();
  const m = n.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) age--;
  return age;
};

const mapPatientDoc = (p, role = "patient") =>
  p
    ? {
        _id: p._id,
        role,
        firstName: decryptSafe(p.firstNameEncrypted) || "—",
        lastName: decryptSafe(p.lastNameEncrypted) || "",
        country: p.country || "—",
        age: calcAge(p.birthDate),
      }
    : null;

const mapUserDoc = (u) =>
  u
    ? {
        _id: u._id,
        role: u.role || "doctor",
        // у User тоже зашифрованы имена — расшифруем тем же локальным helper’ом
        firstName: decryptSafe(u.firstNameEncrypted) || "—",
        lastName: decryptSafe(u.lastNameEncrypted) || "",
        country: u.country || "—",
        age: calcAge(u.dateOfBirth),
      }
    : null;

// --- контроллер ---
export const getAppointmentAuditController = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    if (!appointmentId) {
      return res.status(400).json({ success: false, message: "Нет ID приёма" });
    }

    console.log("📥 Получен запрос аудита:", appointmentId);

    // В схеме Audit: byUserId -> ref:"User", targetPatientId -> ref:"NewPatientPolyclinic"
    const logs = await AppointmentAudit.find({ appointmentId })
      .populate({
        path: "byUserId",
        model: User.modelName || "User",
        select: "role firstNameEncrypted lastNameEncrypted country dateOfBirth",
      })
      .populate({
        path: "targetPatientId",
        model: NewPatientPolyclinic.modelName || "NewPatientPolyclinic",
        select: "firstNameEncrypted lastNameEncrypted country birthDate",
      })
      .sort({ createdAt: 1 })
      .lean();

    console.log("📄 Найдено записей аудита:", logs.length);

    const result = logs.map((log) => {
      // Пациента всегда берём из NewPatientPolyclinic (как вы просили)
      const patient = mapPatientDoc(log.targetPatientId, "patient");

      // Исполнитель действия по схеме — это User (ref:"User").
      // Мы расшифровываем его локально той же логикой, но не трогаем модель пациента.
      // Если когда-то перейдёте на хранение врачей в коллекции пациентов — можно будет
      // тут добавить fallback populate по NewPatientPolyclinic.
      const actor = mapUserDoc(log.byUserId);

      return {
        ...log,
        byUserId: actor, // кто совершил действие (врач/админ/пациент)
        targetPatientId: patient, // сам пациент из NPC
      };
    });

    return res.json({ success: true, count: result.length, data: result });
  } catch (error) {
    console.error("❌ Ошибка получения аудита:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка при получении истории действий: " + error.message,
    });
  }
};
