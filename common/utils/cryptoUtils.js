import crypto from "crypto";
import "dotenv/config";

// ===============================
//   LOAD & VALIDATE SECRET KEY
// ===============================

// Получаем ключ из .env
const rawKey = process.env.ENCRYPTION_KEY;

// Если ключ отсутствует — выводим явную ошибку
if (!rawKey) {
  console.error("❌ ENCRYPTION_KEY is missing in environment variables!");
  throw new Error("ENCRYPTION_KEY is required but not provided.");
}

// Делаем ключ ровно 32 байта (AES-256)
const SECRET_KEY = rawKey.padEnd(32, "0").slice(0, 32);

// ===============================
//        ENCRYPT FUNCTION
// ===============================
export const encrypt = (text) => {
  if (!text || text.includes(":")) return text;

  const iv = crypto.randomBytes(16); // Initialization vector (16 bytes)
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    iv
  );

  let encrypted = cipher.update(text, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
};

// ===============================
//        DECRYPT FUNCTION
// ===============================
export const decrypt = (text) => {
  if (!text || !text.includes(":")) return text;

  try {
    const [ivHex, encryptedHex] = text.split(":");

    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(ivHex, "hex")
    );

    let decrypted = decipher.update(Buffer.from(encryptedHex, "hex"));
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString("utf8");
  } catch (err) {
    console.error("❌ Ошибка дешифровки:", err.message);
    return null;
  }
};

// ===============================
//       HASH FUNCTION
// ===============================
export const hashData = (data) => {
  return crypto
    .createHash("sha256")
    .update(String(data).toLowerCase())
    .digest("hex");
};
