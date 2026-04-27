import crypto from "crypto";

/* ============================================================
   EXTRACT ACTOR & CONTEXT
   ============================================================
   Готовит req.actor и req.context для использования
   в контроллерах модуля.

   Должен быть подключён ПОСЛЕ authMiddleware,
   потому что использует req.user.

   Поддерживает ОБА формата, в которых в проекте DocPats
   может прийти req.user:
   1. req.user — полный mongoose-документ (User.findById)
      → req.user._id доступен
   2. req.user — простой объект (сборка вручную в middleware)
      → req.user.userId доступен, _id отсутствует

   Плюс резервно смотрим в req.userId (legacy).
   ============================================================ */

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
      "[extractActor] Could not extract userId from req.user",
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
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.get("user-agent"),
    sessionId: req.sessionID,
    requestId: req.id || crypto.randomUUID(),
  };

  next();
};

export default extractActor;
