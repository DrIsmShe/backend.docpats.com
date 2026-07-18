// server/modules/me/me.routes.js
// ─────────────────────────────────────────────────────────────────────
//   Роуты "обо мне" — статус trial, текущий план и т.д.
//
//   Подключить в главном index.js / app.js:
//   import meRoutes from "./modules/me/me.routes.js";
//   app.use("/api/me", meRoutes);
// ─────────────────────────────────────────────────────────────────────

import express from "express";
import { getTrialStatus } from "./trial.controller.js";
import { getMyReferral } from "./referral.controller.js";

const router = express.Router();

// Простая проверка авторизации (если у тебя есть готовый authMiddleware —
// замени на него)
function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({
      success: false,
      message: "Not authenticated",
    });
  }
  next();
}

router.get("/trial-status", requireAuth, getTrialStatus);
router.get("/referral", requireAuth, getMyReferral);

export default router;
