import { tReq } from "../../common/i18n/index.js";
import { errorText } from "../../common/i18n/index.js";
import {
  generateUserSynthesis,
  checkUserLimit,
  getUserArticles,
  getUserArticle,
} from "./userSynthesis.service.js";
import {
  PLAN_LIMITS,
  PLAN_PRICES,
} from "../../common/config/aiPlanLimits.js";

// Планы, которые витрина генератора вообще показывает. Пациентских здесь нет:
// генератор врачебный (см. requireDoctorRole на маршрутах).
const SHOWN_PLANS = [
  "guest",
  "doctor_free",
  "doctor_trial",
  "doctor_basic",
  "doctor_super",
  "doctor_pro",
];

/**
 * Сколько статей в месяц даёт каждый тариф — из того же конфига, по которому
 * работает запрет. Отдаётся клиенту, чтобы витрина не хранила свои числа.
 * -1 означает «без ограничения».
 */
function getArticlesCatalog() {
  const catalog = {};
  for (const key of SHOWN_PLANS) {
    const articles = PLAN_LIMITS?.[key]?.aiArticles;
    if (articles === undefined) continue;
    catalog[key] = {
      articles,
      price: PLAN_PRICES?.[key]?.monthly ?? 0,
    };
  }
  return catalog;
}

// POST /api/user-synthesis/generate
export async function generate(req, res) {
  try {
    // Ни сессия, ни заголовок cookie в лог НЕ пишутся. Подписанная кука —
    // это готовый ключ входа: вставил в браузер и ты этот пользователь, без
    // пароля. Логи читают шире, чем базу, живут дольше и попадают в резервные
    // копии, поэтому им там не место. (На момент правки в логе прода лежало
    // 26 таких кук.)
    const userId = req.session?.userId || null;
    const {
      topic,
      sources = [],
      language = "ru",
      style = "analytical",
    } = req.body;

    if (!topic || topic.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.article.topicTooShort"),
      });
    }

    if (topic.length > 200) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.article.topicTooLong"),
      });
    }

    const result = await generateUserSynthesis({
      userId,
      // req нужен для учёта гостей: по нему считается отпечаток адреса.
      req,
      topic: topic.trim(),
      sources,
      language,
      style,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    const isLimitError = err.message.includes("Лимит исчерпан");
    res.status(isLimitError ? 403 : 500).json({
      success: false,
      message: errorText(err, req),
    });
  }
}

// GET /api/user-synthesis/limit
export async function getLimit(req, res) {
  try {
    const userId = req.session?.userId || null;
    // Без consume: страница спрашивает счётчик при каждом открытии, и списывать
    // здесь попытку значило бы тратить лимит на просмотр.
    const result = await checkUserLimit(userId, { req });

    console.log("[LIMIT] checkUserLimit result =", result);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Каталог тарифов отдаём ВМЕСТЕ с лимитом.
    //
    // До этого числа на витрине были вписаны руками в файлы переводов и
    // разошлись с действительностью по всем строкам сразу: пробный период
    // обещал 10 статей и показывал «2 / 4», Doctor Start продавал 3 вместо 4,
    // Doctor Growth — 15 вместо 12, Doctor Pro — «безлимит» вместо 25.
    // Единственный источник правды — aiPlanLimits.js, поэтому витрина берёт
    // числа оттуда же, откуда берётся запрет.
    res.json({ success: true, ...result, catalog: getArticlesCatalog() });
  } catch (err) {
    console.error("[LIMIT] ERROR:", err);
    res.status(500).json({ success: false, message: errorText(err, req) });
  }
}

// GET /api/user-synthesis/my
export async function getMy(req, res) {
  try {
    console.log("━━━━━━━━━━ [MY] ━━━━━━━━━━");
    console.log("[MY] userId =", req.session?.userId);

    const userId = req.session?.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: tReq(req, "app.auth.notAuthorized") });
    }
    const { page, limit } = req.query;
    const result = await getUserArticles(userId, { page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: errorText(err, req) });
  }
}

// GET /api/user-synthesis/my/:id
export async function getMyOne(req, res) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: tReq(req, "app.auth.notAuthorized") });
    }
    const article = await getUserArticle(userId, req.params.id);
    res.json({ success: true, article });
  } catch (err) {
    res.status(404).json({ success: false, message: errorText(err, req) });
  }
}
