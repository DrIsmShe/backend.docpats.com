// modules/analytics/controllers/analytics.controller.js
//
// Админский дашборд посещаемости. Все маршруты уже закрыты requireAdmin
// (см. analytics.routes.js), здесь остаётся только собрать данные.
//
// Каждая вкладка фронтенда — один запрос сюда. Разбито по вкладкам, а не
// одной «всё сразу»: страница со всеми разрезами делает под шесть десятков
// обращений к PostHog, и грузить их разом ради экрана, где смотрят одну
// вкладку, незачем.

import { runBatch, toObjects, clearAnalyticsCache } from "../services/posthog.service.js";
import { isAnalyticsConfigured, POSTHOG_HOST, POSTHOG_PROJECT_ID, CACHE_TTL_MS } from "../analytics.config.js";
import { safeDays } from "../queries/_shared.js";
import { overviewQueries } from "../queries/overview.js";
import { pagesQueries } from "../queries/pages.js";
import { audienceQueries } from "../queries/audience.js";
import { acquisitionQueries } from "../queries/acquisition.js";
import { behaviorQueries } from "../queries/behavior.js";
import { performanceQueries } from "../queries/performance.js";
import { liveQueries, eventLogQuery } from "../queries/live.js";
import { eventDetailQueries, allCustomEventPropsQuery } from "../queries/eventDetail.js";
import { tReq } from "../../../common/i18n/index.js";
import { errorText } from "../../../common/i18n/index.js";

/**
 * Выполнить набор блоков и вернуть { имя: [{колонка: значение}, …] }.
 * Блок, который не собрался, приходит как { error } и не мешает остальным.
 */
async function collect(blocks, opts = {}) {
  const sqls = {};
  for (const [name, block] of Object.entries(blocks)) sqls[name] = block.sql;

  const raw = await runBatch(sqls, opts);

  const out = {};
  for (const [name, block] of Object.entries(blocks)) {
    out[name] = toObjects(raw[name], block.columns);
  }
  return out;
}

/** Обёртка вокруг обработчика: единый ответ при отсутствии настроек и падении. */
function handler(fn) {
  return async (req, res) => {
    if (!isAnalyticsConfigured()) {
      return res.status(503).json({
        configured: false,
        message:
          tReq(req, "app.analytics.notConfigured") +
          "и перезапустите процесс через pm2 restart all --update-env",
      });
    }
    try {
      const data = await fn(req);
      res.json({ configured: true, ...data });
    } catch (err) {
      const status = err.statusCode || 500;
      // Стек — только для настоящих сбоев. Кривой запрос из формы админки
      // это не происшествие, и засорять им лог PM2 незачем.
      if (status >= 500) console.error("[analytics]", err);
      else console.warn("[analytics]", err.message);

      res.status(status).json({
        configured: true,
        message: errorText(err, req) || "Не удалось получить статистику",
      });
    }
  };
}

// ─── GET /admin/analytics/status ────────────────────────────────
// Настроен ли модуль и куда он ходит. Ключ, разумеется, не отдаём.
export function getStatus(req, res) {
  res.json({
    configured: isAnalyticsConfigured(),
    host: POSTHOG_HOST,
    projectId: POSTHOG_PROJECT_ID || null,
    cacheTtlMinutes: Math.round(CACHE_TTL_MS / 60000),
  });
}

// ─── GET /admin/analytics/overview?days=30 ──────────────────────
export const getOverview = handler(async (req) => {
  const days = safeDays(req.query.days);
  return { days, data: await collect(overviewQueries(days)) };
});

// ─── GET /admin/analytics/pages?days=30 ─────────────────────────
export const getPages = handler(async (req) => {
  const days = safeDays(req.query.days);
  return { days, data: await collect(pagesQueries(days)) };
});

// ─── GET /admin/analytics/audience?days=30 ──────────────────────
export const getAudience = handler(async (req) => {
  const days = safeDays(req.query.days);
  return { days, data: await collect(audienceQueries(days)) };
});

// ─── GET /admin/analytics/acquisition?days=30 ───────────────────
export const getAcquisition = handler(async (req) => {
  const days = safeDays(req.query.days);
  return { days, data: await collect(acquisitionQueries(days)) };
});

// ─── GET /admin/analytics/behavior?days=30 ──────────────────────
// К обычным блокам добавлен разворот свойств продуктовых событий: без него
// таблица отвечает «сдано 120 попыток», но не «из них 60 по снимкам».
export const getBehavior = handler(async (req) => {
  const days = safeDays(req.query.days);
  return {
    days,
    data: await collect({
      ...behaviorQueries(days),
      customEventProps: allCustomEventPropsQuery(days),
    }),
  };
});

// ─── GET /admin/analytics/event?name=&days=30 ───────────────────
// Детализация одного события: динамика, зоны, экраны и разбивка по его
// собственным свойствам.
export const getEventDetail = handler(async (req) => {
  const name = String(req.query.name || "").trim();
  if (!name) {
    const err = Object.assign(new Error("Не указано имя события"), { i18n: "app.analytics.eventNameMissing" });
    err.statusCode = 400;
    throw err;
  }
  const days = safeDays(req.query.days);
  return { days, event: name, data: await collect(eventDetailQueries(name, days)) };
});

// ─── GET /admin/analytics/performance?days=30 ───────────────────
export const getPerformance = handler(async (req) => {
  const days = safeDays(req.query.days);
  return { days, data: await collect(performanceQueries(days)) };
});

// ─── GET /admin/analytics/live ──────────────────────────────────
// Единственная вкладка мимо кеша: «сейчас на сайте» пятиминутной давности
// бесполезно.
export const getLive = handler(async () => {
  return { data: await collect(liveQueries(), { noCache: true }) };
});

// ─── GET /admin/analytics/events?days=&event=&screen=&limit= ────
// Журнал событий — аналог Activity → Explore в самом PostHog.
export const getEventLog = handler(async (req) => {
  const block = eventLogQuery({
    days: req.query.days,
    event: req.query.event,
    screen: req.query.screen,
    limit: req.query.limit,
  });
  const rows = await collect({ log: block }, { noCache: true });
  return { data: rows.log };
});

// ─── POST /admin/analytics/refresh ──────────────────────────────
// Сбросить кеш — кнопка «обновить» в админке.
export const refresh = handler(async () => {
  clearAnalyticsCache();
  return { refreshed: true };
});
