// server/modules/guide/guide.routes.js
//
// Два входа в одного агента.
//
//   гостевой  — монтируется в /api/v1/public, ДО session-middleware: человек
//     задаёт вопрос до регистрации, ради этого гид и делается;
//   авторизованный — тот же сервис, но роль берётся из сессии, и ответ
//     учитывает, врач это или пациент.
//
// Агент один, потому что различает их не набор знаний, а контекст: корпус для
// врача и для пациента общий, разные в нём только разделы. Два агента
// означали бы два промпта, которые разойдутся.

import express from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../common/middlewares/errorHandler.js";
import { langOf } from "../../common/utils/requestLang.js";
import { askGuide } from "./guide.service.js";
import logger from "../../common/logger.js";

const skipInTests = () => process.env.NODE_ENV === "test";

// Публичный эндпоинт к модели — это то, что рано или поздно попробуют
// использовать как бесплатный прокси. Лимит считает по адресу и щедр к
// живому человеку: десять вопросов в минуту не наберёт никто, кто правда
// читает ответы.
const guestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.GUIDE_GUEST_RPM ?? 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  message: { error: "Слишком много вопросов подряд. Попробуйте через минуту." },
});

const authedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.GUIDE_AUTH_RPM ?? 30),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  message: { error: "Слишком много вопросов подряд. Попробуйте через минуту." },
});

function sectionOf(req) {
  const raw = String(req.body?.section ?? "").toLowerCase();
  const safe = raw.replace(/[^a-z0-9-]/g, "");
  return safe || null;
}

async function handle(req, res, role) {
  const started = Date.now();
  const result = await askGuide({
    messages: req.body?.messages,
    lang: langOf(req),
    role,
    section: sectionOf(req),
  });

  // Что спрашивают — единственный способ узнать, чего не хватает в корпусе.
  // Сам вопрос не пишем: у гостя он может содержать что угодно, включая
  // жалобы на здоровье, а это данные, которых у нас нет причин хранить.
  logger?.info?.(
    {
      role,
      lang: langOf(req),
      chars: String(req.body?.messages?.at?.(-1)?.content ?? "").length,
      refused: result.refused,
      ms: Date.now() - started,
      usage: result.usage,
    },
    "guide: ответ",
  );

  res.json({ answer: result.answer, refused: result.refused, truncated: Boolean(result.truncated) });
}

/** Гость: без сессии, монтируется в /api/v1/public. */
export const guestGuideRouter = express.Router();
guestGuideRouter.post(
  "/guide/ask",
  guestLimiter,
  asyncHandler((req, res) => handle(req, res, "guest")),
);

/** Авторизованный: роль из сессии. Монтируется после session-middleware. */
export const guideRouter = express.Router();
guideRouter.post(
  "/ask",
  authedLimiter,
  asyncHandler(async (req, res) => {
    // Сессия есть — но роль в ней не лежит, а тянуть пользователя из базы
    // ради одного слова дорого. Роль присылает клиент, и это безопасно
    // ровно потому, что она ни к чему не даёт доступа: у агента нет
    // инструментов, она влияет только на тон и на выбор раздела.
    const claimed = String(req.body?.role ?? "").toLowerCase();
    const role = ["doctor", "patient", "clinic_admin", "clinic_staff", "admin"].includes(claimed)
      ? claimed
      : "guest";
    return handle(req, res, req.session?.userId ? role : "guest");
  }),
);
