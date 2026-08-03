// modules/analytics/queries/live.js
//
// Вкладка «Сейчас» и журнал событий.
//
// Журнал — это тот самый экран, ради которого обычно и открывают
// Activity → Explore в самом PostHog: поток последних событий, как они
// пришли. Здесь он живёт под своей же админкой и с теми же правами.

import { safeDays, TOP_LIMIT, quote } from "./_shared.js";

// «Сейчас» — последние полчаса. Кеш для этих запросов отключается в
// контроллере, иначе живая панель показывала бы пятиминутной давности.
const LIVE_WINDOW = "now() - INTERVAL 30 MINUTE";

export function liveQueries() {
  return {
    // Сколько людей в системе прямо сейчас.
    active: {
      columns: ["visitors", "sessions", "events"],
      sql: `
        SELECT count(DISTINCT distinct_id)            AS visitors,
               count(DISTINCT properties.$session_id) AS sessions,
               count()                                AS events
        FROM events
        WHERE timestamp >= ${LIVE_WINDOW}`,
    },

    // Где они находятся.
    activeScreens: {
      columns: ["screen", "visitors"],
      sql: `
        SELECT coalesce(properties.path_template, properties.$pathname, '—') AS screen,
               count(DISTINCT distinct_id) AS visitors
        FROM events
        WHERE timestamp >= ${LIVE_WINDOW} AND event = '$pageview'
        GROUP BY screen
        ORDER BY visitors DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Пульс по минутам за полчаса.
    byMinute: {
      columns: ["minute", "events", "visitors"],
      sql: `
        SELECT toStartOfMinute(timestamp)  AS minute,
               count()                     AS events,
               count(DISTINCT distinct_id) AS visitors
        FROM events
        WHERE timestamp >= ${LIVE_WINDOW}
        GROUP BY minute
        ORDER BY minute ASC`,
    },

    // Последние события — короткая лента для верхней части вкладки.
    latest: {
      columns: ["timestamp", "event", "screen", "zone", "country", "device", "distinctId"],
      sql: `
        SELECT timestamp                                                     AS timestamp,
               event                                                         AS event,
               coalesce(properties.path_template, properties.$pathname, '—') AS screen,
               coalesce(properties.zone, '—')                                AS zone,
               coalesce(properties.$geoip_country_name, '—')                 AS country,
               coalesce(properties.$device_type, '—')                        AS device,
               distinct_id                                                   AS distinctId
        FROM events
        ORDER BY timestamp DESC
        LIMIT 50`,
    },
  };
}

/**
 * Журнал событий с фильтрами — аналог Activity → Explore.
 *
 * Все три фильтра приходят из формы в админке и попадают в текст запроса,
 * поэтому каждый проходит через собственную санацию: период — целое число,
 * имя события и экран — экранирование кавычек, лимит — целое в диапазоне.
 * Свободного текста в SQL не остаётся.
 */
export function eventLogQuery({ days, event, screen, limit }) {
  const conditions = [`timestamp >= now() - INTERVAL ${safeDays(days)} DAY`];

  if (event) conditions.push(`event = ${quote(event)}`);
  if (screen) {
    conditions.push(
      `coalesce(properties.path_template, properties.$pathname) = ${quote(screen)}`,
    );
  }

  const rows = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 500);

  return {
    columns: [
      "timestamp", "event", "screen", "zone", "country", "city",
      "device", "browser", "os", "referrer", "sessionId", "distinctId",
    ],
    sql: `
      SELECT timestamp                                                     AS timestamp,
             event                                                         AS event,
             coalesce(properties.path_template, properties.$pathname, '—') AS screen,
             coalesce(properties.zone, '—')                                AS zone,
             coalesce(properties.$geoip_country_name, '—')                 AS country,
             coalesce(properties.$geoip_city_name, '—')                    AS city,
             coalesce(properties.$device_type, '—')                        AS device,
             coalesce(properties.$browser, '—')                            AS browser,
             coalesce(properties.$os, '—')                                 AS os,
             coalesce(properties.$referring_domain, '$direct')             AS referrer,
             coalesce(properties.$session_id, '—')                         AS sessionId,
             distinct_id                                                   AS distinctId
      FROM events
      WHERE ${conditions.join(" AND ")}
      ORDER BY timestamp DESC
      LIMIT ${rows}`,
  };
}
