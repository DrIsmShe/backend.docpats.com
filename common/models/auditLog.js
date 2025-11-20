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
    iv
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
      Buffer.from(iv, "hex")
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
    action: {
      type: String,
      required: true,
      enum: [
        "User Registered",
        "User Deleted",
        "User Updated",
        "Login", // 👈 Добавляем "Login"
        "Logout",
        "Login Attempt",
        "Password Reset",
        "Account Blocked",
      ],
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    ip: {
      type: String,
      required: true,
    },
    details: {
      type: String,
      required: false,
    },
  },
  { timestamps: true }
);

// ✅ **Добавляем индекс для быстрого поиска логов**
auditLogSchema.index({ userId: 1, timestamp: -1 });

// ✅ **Метод для записи лога**
auditLogSchema.statics.createLog = async function (
  userId,
  action,
  ip,
  details = ""
) {
  try {
    const log = await this.create({ userId, action, ip, details });
    console.log(`📌 [Audit Log] ${action} записан для пользователя ${userId}`);
    return log;
  } catch (error) {
    console.error("❌ Ошибка записи в AuditLog:", error.message);
  }
};

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

export default AuditLog;
