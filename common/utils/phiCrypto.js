// common/utils/phiCrypto.js
//
// Единый помощник шифрования текстового PHI (AES-256-CBC, ключ ENCRYPTION_KEY).
// Формат хранения: "iv:ciphertext" (2 части hex) — тот же, что у ClinicPatient
// и Message. Заменяет копипаст encrypt/decrypt, разбросанный по моделям.
//
// ВАЖНО про чтение: шифровать нужно ТОЛЬКО поля, по которым НЕ ищут regex-ом
// (иначе поиск по шифртексту невозможен — нужен отдельный blind-index).
// И расшифровывать в КАЖДОМ месте чтения — особенно после .lean(), т.к. lean
// не вызывает getters/методы.

import crypto from "node:crypto";

const RAW_KEY = process.env.ENCRYPTION_KEY || "";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

// Похоже ли значение на наш шифртекст: "hex32:hex...".
const CIPHER_RE = /^[0-9a-f]{32}:[0-9a-f]+$/i;

/** Уже зашифровано нашим форматом? */
export function isEncrypted(value) {
  return typeof value === "string" && CIPHER_RE.test(value);
}

/**
 * Зашифровать строку. null/undefined/"" возвращаются как есть. Уже
 * зашифрованное значение не шифруется повторно (идемпотентно).
 */
export function encryptPHI(value) {
  if (value == null) return value;
  const s = String(value);
  if (!s) return s;
  if (isEncrypted(s)) return s;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(SECRET_KEY), iv);
  const enc = Buffer.concat([cipher.update(s, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * Расшифровать строку. Если значение не в нашем формате (уже plaintext или
 * null) — вернуть как есть. При повреждённом шифртексте — вернуть null, а не
 * бросать, чтобы одна битая запись не роняла весь ответ.
 */
export function decryptPHI(value) {
  if (value == null) return value;
  const s = String(value);
  if (!isEncrypted(s)) return s;
  try {
    const [ivHex, dataHex] = s.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(ivHex, "hex"),
    );
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Расшифровать перечисленные поля объекta (мутирует копию, не оригинал).
 * Удобно применять к результату .lean() перед отдачей наружу.
 *
 * @param {object|null} obj
 * @param {string[]} fields — плоские имена полей для расшифровки
 * @returns {object|null}
 */
export function decryptFields(obj, fields) {
  if (!obj) return obj;
  const out = { ...obj };
  for (const f of fields) {
    if (out[f] != null) out[f] = decryptPHI(out[f]);
  }
  return out;
}
