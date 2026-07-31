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
import User from "../../common/models/Auth/users.js";
import logger from "../../common/logger.js";

const KNOWN_ROLES = ["doctor", "patient", "admin", "clinic_admin", "clinic_staff"];

/**
 * Кто спрашивает — по СЕССИИ, а не по тому, что прислал браузер и не по зоне
 * адреса.
 *
 * Сначала роль угадывалась на клиенте по префиксу пути, и это было неверно по
 * сути: врач, открывший помощника на лендинге, считался гостем, а пациент в
 * разделе документации — тоже. Роль — свойство человека, а не страницы, на
 * которой он стоит.
 *
 * Запрос к базе на каждый вопрос дешёвый (одно поле по _id) и стоит того:
 * иначе роль приходится принимать на веру от браузера.
 */
async function roleOf(req) {
  const userId = req.session?.userId;
  if (!userId) return "guest";
  try {
    const user = await User.findById(userId).select("role").lean();
    return KNOWN_ROLES.includes(user?.role) ? user.role : "guest";
  } catch (err) {
    logger?.warn?.({ err }, "guide: роль не определилась, отвечаем как гостю");
    return "guest";
  }
}

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

/**
 * Кто спрашивает — для интерфейса. Виджету это нужно, чтобы показать
 * подсказки под аудиторию: врачу незачем предлагать «кто видит мою историю
 * болезни», это вопрос пациента.
 *
 * Отдельный лёгкий запрос, а не поле в ответе на вопрос: подсказки нужны ДО
 * первого вопроса, когда спрашивать ещё нечего.
 */
guideRouter.get(
  "/context",
  asyncHandler(async (req, res) => {
    res.json({ role: await roleOf(req) });
  }),
);

guideRouter.post(
  "/ask",
  authedLimiter,
  asyncHandler(async (req, res) => handle(req, res, await roleOf(req))),
);
