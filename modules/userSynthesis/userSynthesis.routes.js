import express from "express";
import rateLimit from "express-rate-limit";

import {
  generate,
  getLimit,
  getMy,
  getMyOne,
} from "./userSynthesis.controller.js";

const router = express.Router();

// Ограничение частоты — второй рубеж после учёта попыток.
//
// Учёт отвечает на вопрос «сколько всего можно», а частота — «как быстро».
// Нужны оба: месячный лимит не мешает выпустить сотню запросов за секунду и
// упереться в потолок уже после того, как деньги потрачены, а модель успела
// отработать сто раз. Генерация к тому же долгая (16 000 токенов), и очередь
// таких запросов сама по себе кладёт процесс, который обслуживает врачей.
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.USER_SYNTHESIS_RATE_LIMIT ?? 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Слишком много запросов на генерацию. Попробуйте через час или войдите в аккаунт.",
  },
});

// Счётчик страница спрашивает при каждом открытии — предел мягче, но он есть:
// эндпоинт ходит в базу, и без него его можно долбить бесплатно.
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Открытый для гостей НАМЕРЕННО: страница — публичная витрина. Но бесплатные
// попытки теперь считаются по-настоящему (common/services/guestQuota.service.js),
// а не показываются надписью «0 из 1».
router.post("/generate", generateLimiter, generate);
router.get("/limit", readLimiter, getLimit); // проверить свой лимит
router.get("/my", readLimiter, getMy); // история (только авториз.)
router.get("/my/:id", readLimiter, getMyOne); // одна статья

export default router;
