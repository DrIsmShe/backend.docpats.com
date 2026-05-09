// server/common/utils/signedUrl.js
//
// Time-limited signed URLs for private resources.
// Used when a patient needs a link to their lab results, prescription PDF, etc.
//
// HMAC-SHA256 signature, embedded TTL.
// No external dependency on jwt — uses Node's built-in crypto.
//
// Usage:
//   const token = createSignedToken({ resourceId, type: "lab_result", patientId }, "7d");
//   // patient receives: https://docpats.com/r/<token>
//   const payload = verifySignedToken(token);  // throws if expired/invalid

import crypto from "crypto";

/**
 * Pick secret from env. Reusing existing keys to avoid polluting .env.
 */
function getSecret() {
  const secret = process.env.SIGNED_URL_SECRET || process.env.SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SIGNED_URL_SECRET (or SECRET) must be set and at least 16 chars",
    );
  }
  return secret;
}

const ALGO = "sha256";

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str) {
  const pad = 4 - (str.length % 4);
  const padded = pad === 4 ? str : str + "=".repeat(pad);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Parse TTL string like "7d", "2h", "30m", "60s" into seconds.
 */
function parseTtl(ttl) {
  if (typeof ttl === "number") return ttl;
  const match = /^(\d+)([smhd])$/.exec(String(ttl));
  if (!match) {
    throw new Error(`Invalid TTL format: ${ttl}. Use "30s", "5m", "2h", "7d"`);
  }
  const n = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s":
      return n;
    case "m":
      return n * 60;
    case "h":
      return n * 60 * 60;
    case "d":
      return n * 60 * 60 * 24;
  }
}

/**
 * Create a signed token for given payload with TTL.
 *
 * @param {object} payload  Arbitrary JSON-serializable data
 * @param {string|number} ttl  Time to live: "7d", "2h", "30m", or seconds
 * @returns {string}  URL-safe token
 */
export function createSignedToken(payload, ttl = "1h") {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload must be an object");
  }
  const ttlSec = parseTtl(ttl);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSec;

  const fullPayload = { ...payload, iat: now, exp };
  const payloadStr = JSON.stringify(fullPayload);
  const payloadB64 = base64UrlEncode(payloadStr);

  const sig = crypto.createHmac(ALGO, getSecret()).update(payloadB64).digest();
  const sigB64 = base64UrlEncode(sig);

  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify and decode a signed token. Throws on invalid signature or expiration.
 *
 * @param {string} token
 * @returns {object}  Decoded payload
 */
export function verifySignedToken(token) {
  if (typeof token !== "string" || !token.includes(".")) {
    const err = new Error("Invalid token format");
    err.code = "INVALID_TOKEN";
    throw err;
  }

  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) {
    const err = new Error("Invalid token format");
    err.code = "INVALID_TOKEN";
    throw err;
  }

  const expectedSig = crypto
    .createHmac(ALGO, getSecret())
    .update(payloadB64)
    .digest();
  const providedSig = base64UrlDecode(sigB64);

  if (
    expectedSig.length !== providedSig.length ||
    !crypto.timingSafeEqual(expectedSig, providedSig)
  ) {
    const err = new Error("Invalid token signature");
    err.code = "INVALID_SIGNATURE";
    throw err;
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    const err = new Error("Invalid token payload");
    err.code = "INVALID_PAYLOAD";
    throw err;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    const err = new Error("Token expired");
    err.code = "TOKEN_EXPIRED";
    err.expiredAt = payload.exp;
    throw err;
  }

  return payload;
}
