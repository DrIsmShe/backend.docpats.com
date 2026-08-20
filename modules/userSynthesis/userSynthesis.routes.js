import express from "express";
import rateLimit from "express-rate-limit";

import {
  generate,
  getLimit,
  getMy,
  getMyOne,
} from "./userSynthesis.controller.js";
import requireDoctorRole from "../../common/middlewares/requireDoctorRole.js";

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

// РАЗДЕЛ ТОЛЬКО ДЛЯ ВРАЧЕЙ.
//
// Раньше генерация была открыта гостям намеренно — как публичная витрина, с
// учётом бесплатных попыток (common/services/guestQuota.service.js). Теперь
// научную статью по медицинским источникам создаёт только врач: пациенту и
// незарегистрированному эта возможность не предназначена.
//
// Проверка стоит на маршруте, а не только в интерфейсе: скрытая на фронте
// кнопка не мешает вызвать эндпоинт напрямую, а генерация — самая дорогая
// операция в приложении (16 000 токенов на запрос).
//
// Ограничители частоты остаются: врач тоже может открыть десять вкладок.
router.post("/generate", requireDoctorRole, generateLimiter, generate);
router.get("/limit", requireDoctorRole, readLimiter, getLimit); // свой лимит
router.get("/my", requireDoctorRole, readLimiter, getMy); // история
router.get("/my/:id", requireDoctorRole, readLimiter, getMyOne); // одна статья

export default router;
