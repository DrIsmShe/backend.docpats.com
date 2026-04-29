// server/modules/simulation/controllers/photoProxyController.js
//
// S.7.7+ — Proxy endpoint для фото симуляции.
//
// Зачем:
//   Прямая раздача через media.docpats.com (Cloudflare Custom Domain → R2)
//   имеет задержку propagation 5-30+ минут на новых файлах. Это ломает
//   UX — после upload фото невидимо в editor'е до тех пор пока CDN edge
//   не подтянется.
//
//   Proxy через backend читает файл напрямую из R2 через S3 SDK, минуя
//   Cloudflare CDN. R2 internal API имеет минимальную eventual consistency
//   (обычно <1 сек), поэтому фото доступно практически сразу после upload.
//
// Endpoint:
//   GET /api/simulation/photos/proxy?key={r2Key}
//
// Authorization:
//   • Только аутентифицированные доктора (requireAuth уже на router level)
//   • Дополнительно проверяем что r2Key принадлежит этому доктору
//     (по prefix simulation/{doctorId}/...)
//
// Caching:
//   • Cache-Control: private, max-age=86400 — браузер кеширует 24ч
//   • ETag из R2 — для conditional requests
//   • Если файл иммутабельный (что наш случай — UUID в имени), это
//     эффективно как CDN, только без propagation задержки

import { s3, BUCKET, KEY_PREFIX } from "../config/r2.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";

/**
 * GET /api/simulation/photos/proxy?key=simulation/{doctorId}/{...}/{file}.jpg
 */
export async function photoProxyController(req, res) {
  try {
    const { key } = req.query;

    if (!key || typeof key !== "string") {
      return res.status(400).json({
        error: "missing_key",
        message: "Query parameter 'key' is required",
      });
    }

    // Защита от path traversal
    if (key.includes("..") || key.includes("//")) {
      return res.status(400).json({
        error: "invalid_key",
        message: "Invalid key format",
      });
    }

    // Authorization: ключ должен начинаться с simulation/{doctorId}/
    const doctorId = String(req.doctorId);
    const requiredPrefix = `${KEY_PREFIX}/${doctorId}/`;
    if (!key.startsWith(requiredPrefix)) {
      return res.status(403).json({
        error: "forbidden",
        message: "You don't have access to this photo",
      });
    }

    // Conditional GET support — если у клиента есть валидный ETag,
    // отдаём 304 Not Modified
    const ifNoneMatch = req.headers["if-none-match"];

    const cmd = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(ifNoneMatch ? { IfNoneMatch: ifNoneMatch } : {}),
    });

    let response;
    try {
      response = await s3.send(cmd);
    } catch (err) {
      // S3 NotModified возвращается как exception в SDK v3
      if (err.name === "NotModified" || err.$metadata?.httpStatusCode === 304) {
        return res.status(304).end();
      }
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({
          error: "not_found",
          message: "Photo not found",
        });
      }
      throw err;
    }

    // Headers
    res.setHeader(
      "Content-Type",
      response.ContentType || "application/octet-stream",
    );
    if (response.ContentLength) {
      res.setHeader("Content-Length", String(response.ContentLength));
    }
    if (response.ETag) {
      res.setHeader("ETag", response.ETag);
    }
    // Файлы immutable (UUID в имени) — кешируем агрессивно у клиента
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");

    // Stream body
    if (response.Body && typeof response.Body.pipe === "function") {
      response.Body.pipe(res);
      // Обработка ошибок stream
      response.Body.on("error", (err) => {
        // eslint-disable-next-line no-console
        console.error("[photoProxy] stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "stream_error" });
        } else {
          res.destroy(err);
        }
      });
    } else if (response.Body) {
      // Fallback: буфер целиком
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      res.send(Buffer.concat(chunks));
    } else {
      res.status(500).json({ error: "empty_body" });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[photoProxy] unexpected error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "internal_error",
        message: "Failed to fetch photo",
      });
    }
  }
}
