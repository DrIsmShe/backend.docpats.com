// modules/analytics/queries/acquisition.js
//
// Вкладка «Источники»: откуда приходят.
//
// Разделяем два разных вопроса. «Referrer события» — откуда человек попал на
// КОНКРЕТНЫЙ экран, и там подавляюще лидирует сам docpats.com (внутренние
// переходы). «Источник сессии» ($session_entry_referring_domain) — откуда он
// пришёл на сайт вообще, и только это отвечает на вопрос про привлечение.

import { since, TOP_LIMIT } from "./_shared.js";

export function acquisitionQueries(days) {
  const from = since(days);

  return {
    // Источник входа в сессию — главная таблица вкладки.
    sessionSources: {
      columns: ["source", "sessions", "visitors"],
      sql: `
        SELECT coalesce(properties.$session_entry_referring_domain, '$direct') AS source,
               count(DISTINCT properties.$session_id)                          AS sessions,
               count(DISTINCT distinct_id)                                     AS visitors
        FROM events
        WHERE timestamp >= ${from}
        GROUP BY source
        ORDER BY sessions DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Referrer уровня события — включая внутренние переходы.
    referrers: {
      columns: ["referrer", "events", "visitors"],
      sql: `
        SELECT coalesce(properties.$referring_domain, '$direct') AS referrer,
               count()                                           AS events,
               count(DISTINCT distinct_id)                       AS visitors
        FROM events
        WHERE timestamp >= ${from}
        GROUP BY referrer
        ORDER BY events DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Полные адреса-источники: видно не только домен, но и конкретную
    // страницу, с которой пришли (поисковая выдача, пост, каталог).
    referrerUrls: {
      columns: ["url", "sessions"],
      sql: `
        SELECT properties.$session_entry_referrer      AS url,
               count(DISTINCT properties.$session_id)  AS sessions
        FROM events
        WHERE timestamp >= ${from}
          AND properties.$session_entry_referrer IS NOT NULL
          AND properties.$session_entry_referrer != '$direct'
        GROUP BY url
        ORDER BY sessions DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // UTM-метки: заполнятся, когда пойдут рекламные кампании. Пока пусто —
    // и это нормально, блок нужен заранее.
    utmSource: utm("utm_source", "source", from),
    utmMedium: utm("utm_medium", "medium", from),
    utmCampaign: utm("utm_campaign", "campaign", from),
    utmContent: utm("utm_content", "content", from),
    utmTerm: utm("utm_term", "term", from),

    // Классификация входов: прямые заходы, поисковики, соцсети, свои
    // страницы, прочее. Грубая, зато читается с одного взгляда.
    channels: {
      columns: ["channel", "sessions"],
      sql: `
        SELECT multiIf(
                 src IS NULL OR src = '$direct',                                  'Прямые заходы',
                 match(src, '(google|yandex|bing|duckduckgo|yahoo|baidu)'),        'Поиск',
                 match(src, '(facebook|instagram|twitter|x\\\\.com|t\\\\.me|telegram|linkedin|vk\\\\.com|youtube|tiktok|whatsapp)'), 'Соцсети и мессенджеры',
                 match(src, 'docpats'),                                           'Внутренние переходы',
                 'Прочие сайты'
               ) AS channel,
               count(DISTINCT sid) AS sessions
        FROM (
          SELECT properties.$session_id                       AS sid,
                 any(properties.$session_entry_referring_domain) AS src
          FROM events
          WHERE timestamp >= ${from} AND properties.$session_id IS NOT NULL
          GROUP BY sid
        )
        GROUP BY channel
        ORDER BY sessions DESC`,
    },
  };
}

/** Разрез по одной UTM-метке. */
function utm(param, alias, from) {
  return {
    columns: [alias, "sessions", "visitors"],
    sql: `
      SELECT properties.${param}                    AS ${alias},
             count(DISTINCT properties.$session_id) AS sessions,
             count(DISTINCT distinct_id)            AS visitors
      FROM events
      WHERE timestamp >= ${from} AND properties.${param} IS NOT NULL
      GROUP BY ${alias}
      ORDER BY sessions DESC
      LIMIT ${TOP_LIMIT}`,
  };
}
