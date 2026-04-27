// server/modules/simulation/config/r2.js
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/* ──────────────────────────────────────────────────────────────────────────
   R2 config. Читаем env один раз при загрузке модуля, падаем с понятной
   ошибкой если чего-то не хватает — лучше узнать на старте сервера,
   чем при первом upload'е в проде.
   ────────────────────────────────────────────────────────────────────────── */
const REQUIRED_ENV = [
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_PUBLIC_URL",
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`[simulation/r2] Missing required env: ${key}`);
  }
}

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
export const BUCKET = process.env.R2_BUCKET;
const PUBLIC_URL = process.env.R2_PUBLIC_URL.replace(/\/$/, ""); // no trailing slash

// R2 endpoint — стандартный шаблон Cloudflare.
const ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;

/* ──────────────────────────────────────────────────────────────────────────
   S3 client. R2 полностью совместим с S3 API.
   region: 'auto' — R2 игнорирует региональность, но SDK требует поле.
   ────────────────────────────────────────────────────────────────────────── */
export const s3 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/* ──────────────────────────────────────────────────────────────────────────
   Namespacing: всё, что создаёт simulation, живёт под своим префиксом.
   simulation/{doctorId}/{planId or 'temp'}/{filename}.
   Это ключевой момент изоляции в общем bucket docpats-media.
   ────────────────────────────────────────────────────────────────────────── */
export const KEY_PREFIX = "simulation";

export function buildKey({ doctorId, planId, filename }) {
  if (!doctorId) throw new Error("[simulation/r2] buildKey requires doctorId");
  if (!filename) throw new Error("[simulation/r2] buildKey requires filename");
  const scope = planId || "temp";
  return `${KEY_PREFIX}/${doctorId}/${scope}/${filename}`;
}

export function publicUrlFor(key) {
  return `${PUBLIC_URL}/${key}`;
}

/* ──────────────────────────────────────────────────────────────────────────
   Core operations. Тонкие обёртки — сервисный слой зовёт их по имени,
   чтобы не таскать команды S3 SDK через весь код.
   ────────────────────────────────────────────────────────────────────────── */
export async function putObject({ key, body, contentType, cacheControl }) {
  if (!key) throw new Error("[simulation/r2] putObject: key required");
  if (!body) throw new Error("[simulation/r2] putObject: body required");

  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType || "application/octet-stream",
    CacheControl: cacheControl || "public, max-age=31536000, immutable",
  });

  await s3.send(cmd);
  return { key, url: publicUrlFor(key) };
}

export async function deleteObject(key) {
  if (!key) return; // no-op, idempotent
  const cmd = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
  try {
    await s3.send(cmd);
  } catch (err) {
    console.warn(
      `[simulation/r2] deleteObject failed for ${key}:`,
      err.message,
    );
    throw err;
  }
}

export async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   Signed URL — на будущее, если bucket станет приватным (HIPAA для US).
   Сейчас не используется, но API готов — переключение = одна строка в
   upload-сервисе.
   ────────────────────────────────────────────────────────────────────────── */
export async function getSignedReadUrl(key, expiresInSeconds = 3600) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}
