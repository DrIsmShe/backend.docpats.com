import { Router } from "express";
import rateLimit from "express-rate-limit";
import User from "../../common/models/Auth/users.js";
import { verifyUnsubscribeToken } from "../../common/services/unsubscribeToken.js";

// Отписка по ссылке из письма. БЕЗ авторизации — это единственный способ,
// которым отписка вообще работает: человек открывает письмо через полгода
// с телефона, и требование вспомнить пароль он заменит на кнопку «спам».
//
// Монтируется на /api/v1/public, то есть ДО session-middleware.

const router = Router();

// Какая рассылка каким полем выключается. Отписка адресная: уйти от
// конференций и продолжать получать письма о приёмах — нормальное желание.
const LIST_FIELDS = {
  conference: "conferenceDigestEnabled",
  digest: "emailDigestEnabled",
};

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function page(title, text) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#222">
<h1 style="font-size:20px">${title}</h1><p style="line-height:1.6">${text}</p>
<p><a href="${process.env.FRONTEND_URL || "https://docpats.com"}">DocPats</a></p>
</body></html>`;
}

async function applyUnsubscribe(token) {
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) return { ok: false };

  const field = LIST_FIELDS[parsed.list];
  if (!field) return { ok: false };

  await User.updateOne({ _id: parsed.userId }, { $set: { [field]: false } });
  return { ok: true, list: parsed.list };
}

// Клик по ссылке из письма.
router.get("/unsubscribe", limiter, async (req, res) => {
  try {
    const result = await applyUnsubscribe(req.query.token);
    if (!result.ok) {
      return res
        .status(400)
        .type("html")
        .send(page("Ссылка не подошла", "Похоже, она устарела. Настройки писем есть в личном кабинете."));
    }
    return res
      .type("html")
      .send(page("Вы отписались", "Больше писем этой рассылки не будет. Остальные уведомления DocPats продолжат приходить — включить рассылку обратно можно в настройках."));
  } catch {
    return res.status(500).type("html").send(page("Ошибка", "Попробуйте позже."));
  }
});

// Отписка в один клик: почтовый клиент дёргает этот адрес сам, по заголовку
// List-Unsubscribe-Post. Человек страницы не видит, поэтому и отвечаем
// пустым 200 — тело всё равно никто не покажет.
router.post("/unsubscribe", limiter, async (req, res) => {
  try {
    const result = await applyUnsubscribe(req.query.token);
    return res.sendStatus(result.ok ? 200 : 400);
  } catch {
    return res.sendStatus(500);
  }
});

export default router;
