// server/common/middlewares/cryptoPhone.js
import crypto from "crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Универсальный разбор ключа: поддержка raw / hex: / b64:
function deriveKeyFromEnv() {
  const raw = process.env.PHONE_SECRET_KEY || "dev-secret-only-for-local";

  // Явно задан hex/b64-ключ
  if (raw.startsWith("hex:")) {
    const buf = Buffer.from(raw.slice(4), "hex");
    if (buf.length !== 32) {
      throw new Error(
        `[cryptoPhone] hex key must be 32 bytes, got ${buf.length}.`
      );
    }
    return buf;
  }
  if (raw.startsWith("b64:")) {
    const buf = Buffer.from(raw.slice(4), "base64");
    if (buf.length !== 32) {
      throw new Error(
        `[cryptoPhone] base64 key must be 32 bytes, got ${buf.length}.`
      );
    }
    return buf;
  }

  // Обычная строка → детерминированно в 32 байта через SHA-256
  return crypto.createHash("sha256").update(raw, "utf8").digest(); // Buffer(32)
}

const KEY = deriveKeyFromEnv(); // Buffer(32)
const ALGO = "aes-256-gcm"; // требует ключ 32 байта
const IV_BYTES = 12;

// Диагностика один раз при загрузке модуля
console.log("[cryptoPhone] module:", __filename);
console.log("[cryptoPhone] algo:", ALGO);
console.log("[cryptoPhone] key is Buffer:", Buffer.isBuffer(KEY));
console.log("[cryptoPhone] key length:", KEY.length);
console.log("[cryptoPhone] iv bytes:", IV_BYTES);

// Жёсткая проверка
if (!Buffer.isBuffer(KEY) || KEY.length !== 32) {
  throw new Error(
    `[cryptoPhone] BAD KEY: expected Buffer(32), got ${
      Buffer.isBuffer(KEY) ? `Buffer(${KEY.length})` : typeof KEY
    }`
  );
}

export function encryptPhone(plainText) {
  if (plainText == null) return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([
    cipher.update(String(plainText), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    enc.toString("base64"),
    tag.toString("base64"),
  ].join(".");
}

export function decryptPhone(payload) {
  if (!payload) return null;
  const [ivB64, dataB64, tagB64] = String(payload).split(".");
  if (!ivB64 || !dataB64 || !tagB64)
    throw new Error("Invalid encrypted payload format");

  const iv = Buffer.from(ivB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const tag = Buffer.from(tagB64, "base64");

  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

export function hashPhone(plainText) {
  return crypto.createHash("sha256").update(String(plainText)).digest("hex");
}
