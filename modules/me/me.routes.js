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
import { getOnboarding } from "./onboarding.controller.js";
import { getMySpecialty } from "./specialty.controller.js";
import { getMyAccessLog } from "./accessLog.controller.js";
import {
  getMyCompetence,
  updateMyCompetence,
} from "../doctorsProfiles/controllers/competence.controller.js";

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
router.get("/onboarding", requireAuth, getOnboarding);

// Специальность врача и отвечающий ей раздел ленты новостей.
router.get("/specialty", requireAuth, getMySpecialty);

// «Кто открывал мою карту». Право пациента знать это и есть причина,
// по которой HIPAA требует журнал доступа; журнал у нас пишется с
// самого начала, а показать его было некому.
router.get("/access-log", requireAuth, getMyAccessLog);

// Своя учебная активность: врач видит её всегда, даже когда показ
// выключен, — иначе он не может решить, включать ли.
router.get("/competence", requireAuth, getMyCompetence);
router.put("/competence", requireAuth, updateMyCompetence);

export default router;
