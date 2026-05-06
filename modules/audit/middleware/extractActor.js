// modules/audit/middleware/extractActor.js
//
// Готовит req.actor и req.context для использования в audit-модуле.
// Должен быть подключён ПОСЛЕ authMiddleware (потому что использует req.user).
//
// Поддерживает оба формата req.user, которые могут прийти в DocPats:
//   1. req.user — полный mongoose-документ (User.findById)
//      → req.user._id доступен
//   2. req.user — простой объект (сборка вручную в middleware)
//      → req.user.userId доступен, _id отсутствует
//
// Плюс резервно смотрим в req.userId (legacy).
//
// ⚠️ Эта версия СКОПИРОВАНА из anthropometry-модуля (extractActor.js)
//    с минимальными изменениями. Если в будущем будут расхождения —
//    нужно решить, объединять или нет.

import crypto from "crypto";

const extractActor = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication required",
      },
    });
  }

  // Универсальное извлечение userId — поддерживаем все форматы auth в проекте.
  const userId =
    req.user._id?.toString?.() ||
    req.user.userId?.toString?.() ||
    req.userId?.toString?.();

  if (!userId) {
    console.error(
      "[audit:extractActor] Could not extract userId from req.user",
      "keys:",
      req.user ? Object.keys(req.user) : "null",
    );
    return res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Could not determine user from request",
      },
    });
  }

  // actor — для передачи в сервисы (формат сервисного слоя)
  req.actor = {
    userId,
    email: req.user.email,
    role: req.user.role,
  };

  // context — метаданные запроса для audit log
  req.context = {
    ipAddress:
      req.ip ||
      req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.connection?.remoteAddress ||
      null,
    userAgent: req.get?.("user-agent") || req.headers?.["user-agent"] || null,
    sessionId: req.sessionID || null,
    requestId: req.id || crypto.randomUUID(),
  };

  next();
};

export default extractActor;
