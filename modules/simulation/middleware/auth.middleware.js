// server/modules/simulation/middleware/auth.middleware.js
import mongoose from "mongoose";

/* ──────────────────────────────────────────────────────────────────────────
   Auth для модуля simulation.

   Контракт: req.session.userId — источник истины (как во всём проекте,
   express-session + connect-mongo). Никаких JWT, никаких header'ов.

   Модуль намеренно self-contained — НЕ импортируем общий authMiddleware
   из других модулей, чтобы ничего не ломать снаружи и чтобы при удалении
   модуля ничего не осталось висеть.

   Результат: req.doctorId — ObjectId, готовый для Mongo query.
   Controllers и services работают только с ним, req.session дальше не
   читают.
   ────────────────────────────────────────────────────────────────────────── */
export function requireAuth(req, res, next) {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Authentication required",
    });
  }

  // Защита от подмены сессии мусором (теоретически не случается, но
  // если случится — 500 лучше чем тихий bypass в Mongo query).
  if (!mongoose.isValidObjectId(userId)) {
    console.warn("[simulation/auth] Invalid userId in session:", userId);
    return res.status(401).json({
      error: "unauthorized",
      message: "Invalid session",
    });
  }

  req.doctorId = new mongoose.Types.ObjectId(userId);
  next();
}
