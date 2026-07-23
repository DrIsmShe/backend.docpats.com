// server/modules/education/education-guest/index.js
//
// Демо-контур «попробовать без регистрации»: 20 вопросов из тестов,
// помеченных админом как витринные (ExamProgram.isFree).
//
// Почему отдельный подмодуль, а не флаг в существующих роутах: весь
// education смонтирован под requireLearner, который отдаёт 401 без
// сессии. Городить внутри него исключения — значит каждый раз помнить,
// что этот конкретный роут может прийти без пользователя. Отдельная
// точка входа делает границу явной: здесь и только здесь userId нет.
//
// Гость опознаётся по req.sessionID. Роутер поэтому монтируется ПОСЛЕ
// session-middleware (см. index.js) — в отличие от /api/v1/public, где
// сессии ещё нет. Cookie гостю выдаётся автоматически, а express-session
// сохраняет тот же id после логина, поэтому попытка потом переносится в
// аккаунт (claimGuestAttempts).
//
// Ограничения демо намеренно жёсткие:
//   - только программы с isFree
//   - только режим tutor (с разбором) — экзамен на время продавать
//     бессмысленно, он не показывает ценность продукта за 20 вопросов
//   - 20 вопросов один раз, без восстановления

import express from "express";
import {
  listPrograms,
  getProgramById,
} from "../education-catalog/services/program.service.js";
import {
  startAttempt,
  getAttemptForLearner,
  answerQuestion,
  submitAttempt,
} from "../education-attempts/services/attempt.service.js";
import { getExamQuota } from "../services/quota.service.js";
import {
  asyncHandler,
  errorHandler,
  notFoundHandler,
} from "../../../common/middlewares/errorHandler.js";
import { NotFoundError } from "../../../common/utils/errors.js";

const router = express.Router();

// Демо-попытка не может быть длиннее гостевой квоты — но и жёстко 20 её
// прибивать не надо: остаток считает assertCanStart, здесь только потолок
// одного захода.
const GUEST_ATTEMPT_QUESTIONS = 20;

/**
 * Гостевой владелец для сервисов попыток.
 *
 * Отметка в сессии здесь обязательна. Session-middleware настроен с
 * saveUninitialized: false — пустая сессия не сохраняется в store и
 * cookie не выдаётся, а значит на КАЖДЫЙ запрос гость получал бы новый
 * req.sessionID. Демо-квота при этом не накапливалась бы никогда (каждый
 * запрос — «новый гость»), а попытка теряла бы владельца сразу после
 * создания. Любая запись в req.session помечает её изменённой, после чего
 * express-session сохраняет её и выставляет cookie.
 */
function guestActor(req) {
  if (!req.session.eduGuest) req.session.eduGuest = true;
  return { userId: null, guestSessionId: req.sessionID };
}

// ─── Витрина: тот же каталог, что и у зарегистрированных ──────────────
//
// Гость видит ВСЕ опубликованные тесты. Ограничивает его не список, а
// квота: 20 вопросов против 250 в месяц. Прятать каталог за регистрацией
// бессмысленно — человек должен увидеть, ради чего регистрируется.
router.get(
  "/programs",
  asyncHandler(async (req, res) => {
    // scope=public по умолчанию отсекает черновики и приватные
    // клинические программы — этого достаточно.
    const items = await listPrograms({});
    res.json({ items });
  }),
);

router.get(
  "/programs/:id",
  asyncHandler(async (req, res) => {
    // getProgramById бросает 404, если теста нет вовсе.
    const program = await getProgramById(req.params.id);
    // Черновики и приватные клинические тесты гостю не показываем.
    if (program.status !== "published" || program.ownerClinicId) {
      throw new NotFoundError("Exam program");
    }
    res.json(program);
  }),
);

// ─── Остаток демо-квоты ───────────────────────────────────────────────
router.get(
  "/quota",
  asyncHandler(async (req, res) => {
    res.json(await getExamQuota(guestActor(req)));
  }),
);

// ─── Попытка ──────────────────────────────────────────────────────────
router.post(
  "/attempts",
  asyncHandler(async (req, res) => {
    const attempt = await startAttempt({
      ...guestActor(req),
      programId: req.body?.programId,
      mode: "tutor",
      questionCount: GUEST_ATTEMPT_QUESTIONS,
      lang: req.body?.lang,
    });
    // Как и в авторизованном контуре: наружу уходит безопасная проекция,
    // а не сырой документ — в нём состав попытки с ключами ответов.
    const view = await getAttemptForLearner(attempt._id, guestActor(req));
    res.status(201).json({ attempt: view });
  }),
);

router.get(
  "/attempts/:id",
  asyncHandler(async (req, res) => {
    const attempt = await getAttemptForLearner(req.params.id, guestActor(req));
    res.json({ attempt });
  }),
);

router.post(
  "/attempts/:id/answer",
  asyncHandler(async (req, res) => {
    const result = await answerQuestion(req.params.id, guestActor(req), {
      itemId: req.body?.itemId,
      selectedKeys: req.body?.selectedKeys,
      timeSpentMs: req.body?.timeSpentMs,
    });
    res.json(result);
  }),
);

router.post(
  "/attempts/:id/submit",
  asyncHandler(async (req, res) => {
    await submitAttempt(req.params.id, guestActor(req));
    // Вместе с результатом отдаём остаток: клиенту сразу нужно решить,
    // показывать «продолжить» или экран регистрации.
    const [attempt, quota] = await Promise.all([
      getAttemptForLearner(req.params.id, guestActor(req)),
      getExamQuota(guestActor(req)),
    ]);
    res.json({ attempt, quota });
  }),
);

router.use(notFoundHandler);
router.use(errorHandler);

export default router;
