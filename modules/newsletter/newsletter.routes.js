// modules/newsletter/newsletter.routes.js
//
// Публичные маршруты подписки на рассылку. Без авторизации: подписывается
// гость, у которого аккаунта нет.
//
// Ответы намеренно одинаковы для «адрес новый» и «адрес уже есть». Иначе
// форма превращается в проверялку: подставляя адреса, посторонний узнавал
// бы, кто зарегистрирован на медицинском сайте. Для медицины это само по
// себе чувствительный факт.

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { tReq } from "../../common/i18n/index.js";
import {
  subscribe,
  confirm,
  unsubscribeByEmail,
  isValidEmail,
} from "./newsletter.service.js";

const router = Router();

// Форму отправляют руками, поэтому лимит низкий: пять попыток за четверть
// часа с адреса. Этого хватает человеку и мало перебору.
const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // Сообщение ограничителя — ФУНКЦИЕЙ, а не готовым объектом.
  //
  // Настройка вычисляется при загрузке модуля, где запроса ещё нет: любое
  // обращение к req там роняет весь файл маршрутов. Функция вызывается на
  // каждый отказ — вот там запрос и появляется, а с ним язык того, кого
  // ограничили.
  message: (req) => ({ ok: false,  error: typeof req.t === "function" ? tReq(req, "app.rateLimit.tooManyAttempts") : "Слишком много попыток, попробуйте позже" }),
});

const confirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/newsletter/subscribe", subscribeLimiter, async (req, res) => {
  try {
    const { email, audience, locale, source } = req.body || {};

    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: "invalid_email" });
    }

    const result = await subscribe({ email, audience, locale, source });

    // Наружу отдаём один и тот же ответ независимо от того, что нашли в
    // базе: подписан, не подписан или недавно уже писали. Разница видна
    // только в логах.
    return res.status(200).json({ ok: true, status: result.status });
  } catch (err) {
    console.error("[newsletter] подписка не удалась:", err.message);
    // 200 намеренно: подробности сбоя посетителю не нужны, а форма не
    // должна выглядеть сломанной из-за временной ошибки почты.
    return res.status(200).json({ ok: true, status: "sent" });
  }
});

router.get("/newsletter/confirm", confirmLimiter, async (req, res) => {
  const result = await confirm(req.query?.token);
  return res.status(result.ok ? 200 : 400).json(result);
});

router.post("/newsletter/unsubscribe", confirmLimiter, async (req, res) => {
  const { email, reason } = req.body || {};
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "invalid_email" });
  }
  await unsubscribeByEmail(email, reason);
  return res.status(200).json({ ok: true });
});

export default router;
