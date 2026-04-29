// server/modules/simulation/controllers/photoProxyController.js
//
// S.7.7+ — Backend прокси для фото из R2.
//
// Frontend получает URL вида:
//   /api/simulation/photos/proxy?key=simulation/{doctorId}/temp/abc.webp
//
// Контроллер:
//   1. Проверяет авторизацию (req.session.userId / req.doctorId)
//   2. Проверяет что key принадлежит этому врачу (защита от path traversal)
//   3. Стримит файл из R2 через S3 SDK
//
// CORS:
//   • Когда <img crossOrigin="use-credentials" src="https://backend.docpats.com/...">
//     загружает картинку с другого домена, браузер требует:
//       - Access-Control-Allow-Origin: точный origin (НЕ "*")
//       - Access-Control-Allow-Credentials: true
//   • Без этих headers браузер блокирует cross-origin <img> с credentials.

import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET || "docpats-media";

/**
 * Парсит список разрешённых origins из ENV.
 * Если переменная не задана — используется fallback на docpats.com и localhost.
 */
function getAllowedOrigins() {
  const fromEnv = process.env.ALLOWED_ORIGINS;
  if (fromEnv) {
    return fromEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [
    "https://docpats.com",
    "https://www.docpats.com",
    "http://localhost:3000",
    "http://localhost:3001",
  ];
}

/**
 * Устанавливает CORS headers для cross-origin <img crossOrigin="use-credentials">.
 * ВАЖНО: с credentials нельзя использовать "*", нужен точный origin.
 */
function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowed = getAllowedOrigins();

  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
}

export async function photoProxyController(req, res) {
  // CORS headers — обязательно ДО любых других ответов
  applyCorsHeaders(req, res);

  // Preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cookie");
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.status(204).end();
  }

  try {
    // 1. Авторизация
    const userId = req.session?.userId || req.doctorId;
    if (!userId) {
      return res
        .status(401)
        .json({ error: "unauthorized", message: "Authentication required" });
    }

    // 2. Парсим key
    const r2Key = req.query.key;
    if (!r2Key || typeof r2Key !== "string") {
      return res
        .status(400)
        .json({ error: "missing_key", message: "key parameter required" });
    }

    // 3. Защита от path traversal
    if (r2Key.includes("..") || r2Key.includes("\\")) {
      return res
        .status(400)
        .json({ error: "invalid_key", message: "Invalid key" });
    }

    // 4. Authorization check: key должен начинаться с simulation/{userId}/
    const expectedPrefix = `simulation/${userId}/`;
    if (!r2Key.startsWith(expectedPrefix)) {
      return res.status(403).json({
        error: "forbidden",
        message: "You don't have access to this photo",
      });
    }

    // 5. HEAD для ETag и Content-Length
    let head;
    try {
      head = await r2Client.send(
        new HeadObjectCommand({ Bucket: BUCKET, Key: r2Key }),
      );
    } catch (err) {
      if (err.$metadata?.httpStatusCode === 404 || err.name === "NotFound") {
        return res
          .status(404)
          .json({ error: "not_found", message: "Photo not found" });
      }
      throw err;
    }

    // 6. Conditional GET (ETag/304)
    const etag = head.ETag;
    if (etag && req.headers["if-none-match"] === etag) {
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "private, max-age=86400, immutable");
      return res.status(304).end();
    }

    // 7. GET object и стрим клиенту
    const obj = await r2Client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: r2Key }),
    );

    res.setHeader(
      "Content-Type",
      obj.ContentType || head.ContentType || "image/webp",
    );
    if (obj.ContentLength || head.ContentLength) {
      res.setHeader("Content-Length", obj.ContentLength || head.ContentLength);
    }
    if (etag) res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");

    // Стрим
    obj.Body.pipe(res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[simulation/photoProxy] error:", err);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: "internal_error", message: "Failed to fetch photo" });
    }
  }
}
