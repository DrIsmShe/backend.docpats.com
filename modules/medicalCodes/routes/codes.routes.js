// server/modules/medicalCodes/routes/codes.routes.js
//
// HTTP-контур справочника кодов. Контроллера отдельным файлом нет намеренно:
// здесь нет бизнес-логики, только разбор параметров и вызов сервиса — лишний
// слой добавил бы файл, но не смысл.

import express from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { langOf } from "../../../common/utils/requestLang.js";
import { tReq } from "../../../common/i18n/index.js";
import {
  searchCodes,
  getCode,
  getStats,
} from "../services/codeSearch.service.js";

const router = express.Router();

// Автокомплит шлёт запрос на каждый ввод — лимит щедрый, он ловит скрипт, а не
// печатающего человека. В тестах отключён, иначе прогон упрётся в лимит.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.MEDICAL_CODES_RPM ?? 120),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  // Сообщение ограничителя — ФУНКЦИЕЙ, а не готовым объектом.
  //
  // Настройка вычисляется при загрузке модуля, где запроса ещё нет: любое
  // обращение к req там роняет весь файл маршрутов. Функция вызывается на
  // каждый отказ — вот там запрос и появляется, а с ним язык того, кого
  // ограничили.
  message: (req) => ({
    error:
      typeof req.t === "function"
        ? tReq(req, "app.codeDirectory.rateLimitExceeded")
        : "Слишком много запросов к справочнику. Подождите минуту.",
  }),
});

/**
 * GET /api/v1/medical-codes/search?q=тонзиллит&system=icd10cm&limit=20
 *
 * Язык берётся из запроса (X-Language), а не из параметра: врач ищет на языке
 * своего интерфейса, и заставлять клиент передавать его отдельно — лишний
 * способ рассинхронизировать.
 */
router.get(
  "/search",
  searchLimiter,
  asyncHandler(async (req, res) => {
    const { items, strategy } = await searchCodes({
      query: req.query.q,
      system: req.query.system || null,
      locale: langOf(req),
      limit: req.query.limit,
    });

    res.json({ items, strategy });
  }),
);

/**
 * GET /api/v1/medical-codes/stats
 *
 * Сколько кодов загружено и сколько переведено. Нужен странице справочника,
 * чтобы честно показать состояние: пока переводов нет, врач должен понимать,
 * почему поиск отвечает по-английски.
 */
router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    res.json(await getStats());
  }),
);

/**
 * GET /api/v1/medical-codes/:system/:code
 *
 * Точное получение кода — чтобы подставить официальное название к коду,
 * который уже лежит в записи (например, пришёл из надиктовки).
 */
router.get(
  "/:system/:code",
  asyncHandler(async (req, res) => {
    const item = await getCode({
      system: req.params.system,
      code: req.params.code,
      locale: langOf(req),
    });

    if (!item) {
      return res.status(404).json({ error: tReq(req, "app.codeDirectory.codeNotFound") });
    }

    res.json(item);
  }),
);

export default router;
