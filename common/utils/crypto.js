// server/common/utils/crypto.js

import crypto from "crypto";

/* ============================================================
   KEY MANAGEMENT
   ============================================================
   ENCRYPTION_KEY должен быть установлен в .env.
   В проде отсутствие ключа — критическая проблема, мы
   логируем её при загрузке модуля. В dev/тестах работает
   с дополненным паддингом, чтобы код не падал. */
const RAW_KEY = process.env.ENCRYPTION_KEY || "";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

if (process.env.NODE_ENV === "production" && !RAW_KEY) {
  console.error(
    "[crypto] CRITICAL: ENCRYPTION_KEY is not set in production environment",
  );
}

/* ============================================================
   FORMAT CHECK
   ============================================================
   Шифротекст имеет формат "IV_HEX:DATA_HEX".
   IV всегда 16 байт = 32 hex-символа.
   Строгая регулярка отвергает строки с двоеточием,
   которые не являются шифротекстом (URL и т.п.). */
const IV_CIPHER_RE = /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;

export const isEncrypted = (value) =>
  typeof value === "string" && IV_CIPHER_RE.test(value);

/* ============================================================
   ENCRYPT
   ============================================================ */
export const encrypt = (value) => {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;

  // Идемпотентность: если уже зашифровано — возвращаем как есть.
  // Защита от двойного шифрования при повторных save().
  if (isEncrypted(s)) return s;

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    iv,
  );
  const encrypted = Buffer.concat([cipher.update(s, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
};

/* ============================================================
   DECRYPT
   ============================================================
   Возвращает:
   - undefined — если входное значение пустое или null
   - исходную строку — если она не похожа на шифротекст
     (для обратной совместимости со старыми данными)
   - расшифрованное значение — если всё ок
   - null — если шифротекст битый (например, ключ изменился) */
export const decrypt = (value) => {
  if (value == null) return undefined;
  if (!isEncrypted(value)) return value;

  try {
    const [ivHex, dataHex] = value.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(ivHex, "hex"),
    );
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (err) {
    console.error("[crypto] decrypt failed:", err.message);
    return null;
  }
};

/* ============================================================
   HASH FOR SEARCH
   ============================================================
   Зашифрованные поля нельзя искать прямым запросом.
   Поэтому рядом с emailEncrypted храним emailHash —
   sha256 от нормализованного значения. По хешу
   можно делать find({ emailHash: ... }). */
export const sha256Lower = (value) =>
  crypto
    .createHash("sha256")
    .update(
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .digest("hex");

/* ============================================================
   NORMALIZERS
   ============================================================
   Применяются ДО хеширования. Иначе "User@Example.COM"
   и "user@example.com" дадут разные хеши и поиск не сработает. */

export const normalizeEmail = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();

export const normalizePhone = (s = "") => {
  const raw = String(s || "");
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d+]/g, "");
  const withPlus = cleaned.startsWith("+")
    ? cleaned
    : `+${cleaned.replace(/^(\+)?/, "")}`;
  return /^\+\d{1,15}$/.test(withPlus) ? withPlus : "";
};
