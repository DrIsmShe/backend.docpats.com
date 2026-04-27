// server/modules/simulation/services/encryption.service.js
import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // GCM spec: 96-bit IV (12 bytes)
const AUTH_TAG_LENGTH = 16; // GCM: 128-bit auth tag
const KEY_ENV = "SURGERY_ENCRYPTION_KEY";

/* ──────────────────────────────────────────────────────────────────────────
   Key loading. Ленивый кэш: не падаем на require, падаем на первом вызове
   с понятной ошибкой. В проде env есть, в тестах иногда нет.
   ────────────────────────────────────────────────────────────────────────── */
let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;

  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(
      `[simulation/encryption] ${KEY_ENV} is not set in environment`,
    );
  }

  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    throw new Error(
      `[simulation/encryption] ${KEY_ENV} must be 32 bytes (64 hex chars); got ${buf.length} bytes`,
    );
  }

  cachedKey = buf;
  return cachedKey;
}

/* ──────────────────────────────────────────────────────────────────────────
   Encrypt: plaintext (utf8) → "iv:authTag:ciphertext" (все в hex).
   null/undefined/'' → null (чтобы пустой label не занимал место в БД).
   ────────────────────────────────────────────────────────────────────────── */
export function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    return null;
  }
  if (typeof plaintext !== "string") {
    throw new TypeError("[simulation/encryption] encrypt expects a string");
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

/* ──────────────────────────────────────────────────────────────────────────
   Decrypt: обратный парс. Бросает Error при повреждённых данных — GCM
   auth tag не сойдётся, и .final() кинет. Не ловим здесь: caller решает,
   вернуть плейсхолдер или залогировать + бросить дальше.
   ────────────────────────────────────────────────────────────────────────── */
export function decrypt(payload) {
  if (payload === null || payload === undefined || payload === "") {
    return null;
  }
  if (typeof payload !== "string") {
    throw new TypeError("[simulation/encryption] decrypt expects a string");
  }

  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "[simulation/encryption] malformed ciphertext (expected iv:tag:data)",
    );
  }

  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");

  if (iv.length !== IV_LENGTH) {
    throw new Error(`[simulation/encryption] bad IV length: ${iv.length}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(
      `[simulation/encryption] bad auth tag length: ${authTag.length}`,
    );
  }

  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);

  return plaintext.toString("utf8");
}

/* ──────────────────────────────────────────────────────────────────────────
   Safe-decrypt: для листингов, где одна сбойная запись не должна убить
   весь ответ. Возвращает fallback вместо throw.
   ────────────────────────────────────────────────────────────────────────── */
export function safeDecrypt(payload, fallback = "") {
  try {
    const v = decrypt(payload);
    return v === null ? fallback : v;
  } catch (err) {
    console.warn("[simulation/encryption] safeDecrypt failed:", err.message);
    return fallback;
  }
}
