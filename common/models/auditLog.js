import mongoose from "mongoose";
import crypto from "crypto";
import "dotenv/config";

// ✅ Генерация ключа, если `ENCRYPTION_KEY` не указан
const generateSecretKey = () => crypto.randomBytes(32).toString("hex");
const SECRET_KEY = process.env.ENCRYPTION_KEY
  ? process.env.ENCRYPTION_KEY.padEnd(32, "0")
  : generateSecretKey();

// 🔹 **Функция шифрования (AES-256-CBC)**
const encrypt = (text) => {
  if (!text || text.includes(":")) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    iv,
  );
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
};

// 🔹 **Функция расшифровки**
const decrypt = (text) => {
  if (!text || !text.includes(":")) return text;
  try {
    const [iv, encryptedText] = text.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(iv, "hex"),
    );
    let decrypted = decipher.update(Buffer.from(encryptedText, "hex"));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error("❌ Ошибка расшифровки:", error.message);
    return null;
  }
};

// ✅ **Схема для логирования действий пользователей**
const auditLogSchema = new mongoose.Schema(
  {
    // что произошло
    action: {
      type: String,
      required: true,
      // никаких enum — чтобы можно было писать любые действия
      trim: true,
    },

    // кто
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // над кем
    patient: {
      type: mongoose.Schema.Types.ObjectId,
    },
    patientModel: {
      type: String,
    },

    // что именно
    studyType: {
      type: String,
    },
    performedOutsideSpecialization: {
      type: Boolean,
    },
    doctorSpecialization: {
      type: String,
    },

    // тех. инфа
    ip: {
      type: String,
    },
    details: {
      type: String,
    },
  },
  { timestamps: true },
);

auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ doctor: 1, createdAt: -1 });
auditLogSchema.index({ patient: 1, createdAt: -1 });

auditLogSchema.statics.createLog = async function (data) {
  try {
    const log = await this.create(data);
    console.log(`📌 [Audit Log] ${data.action}`, {
      userId: data.userId,
      doctor: data.doctor,
      patient: data.patient,
    });
    return log;
  } catch (error) {
    console.error("❌ Ошибка записи в AuditLog:", error.message);
  }
};

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

export default AuditLog;
