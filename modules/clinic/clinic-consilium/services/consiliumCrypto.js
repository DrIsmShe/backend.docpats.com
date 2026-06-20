// server/modules/clinic/clinic-consilium/services/consiliumCrypto.js
//
// AES-256-GCM encryption for consilium message bodies (possible PHI).
//
// Uses the project's canonical surgery/message format and key:
//   - key:    process.env.SURGERY_ENCRYPTION_KEY (32-byte hex = 64 chars)
//   - format: "iv:authTag:ciphertext", all hex
//
// This mirrors the existing message-encryption scheme so ciphertext is
// interoperable. The key is read LAZILY (inside encrypt/decrypt), not at
// import time, so unit tests can set it in a beforeAll hook.

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // standard GCM nonce length

function getKey() {
  const hex = process.env.SURGERY_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "SURGERY_ENCRYPTION_KEY must be a 32-byte hex string (64 chars)",
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt a UTF-8 string → "iv:authTag:ciphertext" (all hex).
 */
export function encryptText(plain) {
  const text = plain == null ? "" : String(plain);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * Decrypt "iv:authTag:ciphertext" → UTF-8 string.
 * Returns "" for empty input. Throws if the payload is malformed or the
 * auth tag does not verify.
 */
export function decryptText(payload) {
  if (!payload) return "";
  const parts = String(payload).split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed ciphertext (expected iv:authTag:ciphertext)");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
