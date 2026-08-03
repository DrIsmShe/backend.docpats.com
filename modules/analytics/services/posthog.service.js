// modules/analytics/services/posthog.service.js
//
// Тонкий клиент к PostHog Query API (HogQL) + кеш в памяти.
//
// Наружу отдаёт две вещи: runQuery() для одиночного запроса и runBatch() для
// пачки — вкладка дашборда почти всегда это пачка независимых запросов,
// которые незачем гнать последовательно.

import {
  POSTHOG_HOST,
  POSTHOG_PROJECT_ID,
  POSTHOG_API_KEY,
  CACHE_TTL_MS,
  REQUEST_TIMEOUT_MS,
  isAnalyticsConfigured,
} from "../analytics.config.js";

// Кеш ответов: ключ — сам текст запроса, значение — { at, rows }.
// Обычная Map, а не Redis: данные не критичны, живут минуты и спокойно
// теряются при рестарте PM2.
const cache = new Map();

// PostHog отвечает на несколько параллельных запросов заметно медленнее,
// если их много. Дашборд шлёт до полутора десятков за раз — ограничиваем,
// чтобы не ловить таймауты и не упираться в лимиты API.
const MAX_PARALLEL = 4;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.rows;
}

/** Сбросить кеш целиком — кнопка «обновить» в админке. */
export function clearAnalyticsCache() {
  cache.clear();
}

/**
 * Выполнить HogQL-запрос.
 *
 * @param {string} query   текст запроса
 * @param {object} [opts]
 * @param {boolean} [opts.noCache]  не читать и не писать кеш (данные «сейчас»)
 * @returns {Promise<Array<Array>>} строки результата
 */
export async function runQuery(query, opts = {}) {
  if (!isAnalyticsConfigured()) {
    throw new Error("PostHog не настроен: нет POSTHOG_API_KEY или POSTHOG_PROJECT_ID");
  }

  const key = query.trim();
  if (!opts.noCache) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }

  // AbortController вместо надежды на дефолтный таймаут fetch: его нет,
  // и зависший запрос держал бы соединение до победного конца.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${POSTHOG_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      signal: abort.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      // Текст ошибки PostHog кладём в лог целиком, а наружу отдаём короткий
      // маркер: в теле ответа встречается имя проекта и куски запроса.
      console.error("[analytics] PostHog вернул", res.status, text.slice(0, 800));
      const err = new Error(describeStatus(res.status));
      err.statusCode = res.status === 401 || res.status === 403 ? 502 : 502;
      throw err;
    }

    const rows = JSON.parse(text).results || [];
    if (!opts.noCache) cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error("PostHog не ответил вовремя");
      e.statusCode = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function describeStatus(status) {
  if (status === 401) return "PostHog отклонил ключ (401): проверьте POSTHOG_API_KEY";
  if (status === 403) return "У ключа нет прав на чтение (403): нужен scope query:read";
  if (status === 404) return "Проект PostHog не найден (404): проверьте POSTHOG_PROJECT_ID";
  if (status === 429) return "PostHog ограничил частоту запросов (429), попробуйте позже";
  return `PostHog вернул ошибку ${status}`;
}

/**
 * Выполнить пачку запросов и собрать результат в объект по тем же ключам.
 *
 * Один упавший запрос НЕ роняет вкладку: на его месте оказывается
 * { error: "…" }, а остальные блоки рисуются. Дашборд из полутора десятков
 * блоков, где любая мелочь гасит весь экран, бесполезен.
 *
 * @param {Record<string,string>} queries  { имяБлока: текстЗапроса }
 * @param {object} [opts] передаётся в runQuery
 */
export async function runBatch(queries, opts = {}) {
  const entries = Object.entries(queries);
  const out = {};

  for (let i = 0; i < entries.length; i += MAX_PARALLEL) {
    const chunk = entries.slice(i, i + MAX_PARALLEL);
    await Promise.all(
      chunk.map(async ([name, query]) => {
        try {
          out[name] = await runQuery(query, opts);
        } catch (err) {
          console.error(`[analytics] блок «${name}» не собрался:`, err.message);
          out[name] = { error: err.message };
        }
      }),
    );
  }

  return out;
}

/**
 * Строки PostHog приходят массивами. Превратить их в объекты по названиям
 * колонок — так фронтенду не нужно помнить порядок полей в каждом запросе.
 */
export function toObjects(rows, columns) {
  if (!Array.isArray(rows)) return rows; // уже { error } — пробрасываем как есть
  return rows.map((row) => {
    const obj = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  });
}
