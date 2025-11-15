import crypto from "crypto";
import "dotenv/config";

const SECRET_KEY = process.env.ENCRYPTION_KEY.padEnd(32, "0");

// 🔹 Функция шифрования (AES-256-CBC)
export const encrypt = (text) => {
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

// 🔹 Функция дешифрования (AES-256-CBC)
export const decrypt = (text) => {
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
    console.error("❌ Ошибка дешифровки:", error.message);
    return null;
  }
};

// 🔹 Функция хеширования данных (SHA-256)
export const hashData = (data) => {
  return crypto.createHash("sha256").update(data.toLowerCase()).digest("hex");
};
