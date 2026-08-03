// modules/analytics/queries/audience.js
//
// Вкладка «Аудитория»: кто заходит — география, устройства, языки.
//
// Всё это PostHog добавляет к событию сам, из IP и user-agent; собственный
// код проекта таких свойств не отправляет.

import { since, TOP_LIMIT } from "./_shared.js";

export function audienceQueries(days) {
  const from = since(days);

  // Один и тот же разрез «свойство → посетители/сессии» нужен десяток раз,
  // поэтому пишем его один раз и подставляем поле.
  const breakdown = (field, alias) => ({
    columns: [alias, "visitors", "sessions", "events"],
    sql: `
      SELECT coalesce(toString(${field}), '—')      AS ${alias},
             count(DISTINCT distinct_id)            AS visitors,
             count(DISTINCT properties.$session_id) AS sessions,
             count()                                AS events
      FROM events
      WHERE timestamp >= ${from}
      GROUP BY ${alias}
      ORDER BY visitors DESC, events DESC
      LIMIT ${TOP_LIMIT}`,
  });

  return {
    countries: breakdown("properties.$geoip_country_name", "country"),
    cities: breakdown("properties.$geoip_city_name", "city"),
    regions: breakdown("properties.$geoip_subdivision_1_name", "region"),
    timezones: breakdown("properties.$timezone", "timezone"),
    languages: breakdown("properties.$browser_language", "language"),
    deviceTypes: breakdown("properties.$device_type", "deviceType"),
    browsers: breakdown("properties.$browser", "browser"),
    os: breakdown("properties.$os", "os"),
    deviceModels: breakdown("properties.$device_model", "deviceModel"),

    // Версии браузера — отдельно, парой полей: без версии список
    // бессмысленно короткий, а с версией видно, кому ломается вёрстка.
    browserVersions: {
      columns: ["browser", "version", "visitors"],
      sql: `
        SELECT coalesce(properties.$browser, '—')                  AS browser,
               coalesce(toString(properties.$browser_version), '—') AS version,
               count(DISTINCT distinct_id)                          AS visitors
        FROM events
        WHERE timestamp >= ${from}
        GROUP BY browser, version
        ORDER BY visitors DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Разрешения экрана — по ним решают, до какой ширины тянуть вёрстку.
    screenSizes: {
      columns: ["size", "visitors"],
      sql: `
        SELECT concat(toString(properties.$screen_width), '×', toString(properties.$screen_height)) AS size,
               count(DISTINCT distinct_id) AS visitors
        FROM events
        WHERE timestamp >= ${from} AND properties.$screen_width IS NOT NULL
        GROUP BY size
        ORDER BY visitors DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Ширина окна, а не экрана: именно она решает, какой сработает
    // медиазапрос. Округляем до сотни, иначе получится список из сотен
    // уникальных значений.
    viewportWidths: {
      columns: ["width", "visitors"],
      sql: `
        SELECT intDiv(toInt(properties.$viewport_width), 100) * 100 AS width,
               count(DISTINCT distinct_id)                          AS visitors
        FROM events
        WHERE timestamp >= ${from} AND properties.$viewport_width IS NOT NULL
        GROUP BY width
        ORDER BY width ASC
        LIMIT ${TOP_LIMIT}`,
    },

    // Активность посетителей: сколько дней каждый заходил. Показывает, есть
    // ли ядро постоянных пользователей или все разовые.
    frequency: {
      columns: ["activeDays", "visitors"],
      sql: `
        SELECT activeDays, count() AS visitors
        FROM (
          SELECT distinct_id, count(DISTINCT toDate(timestamp)) AS activeDays
          FROM events
          WHERE timestamp >= ${from}
          GROUP BY distinct_id
        )
        GROUP BY activeDays
        ORDER BY activeDays ASC`,
    },

    // Опознанные пользователи против анонимных. Пока identifyUser() в
    // клиенте не вызывается, здесь честно будет 100% анонимных — и это сам
    // по себе полезный сигнал.
    identified: {
      columns: ["identified", "visitors"],
      sql: `
        SELECT if(properties.$is_identified, 'identified', 'anonymous') AS identified,
               count(DISTINCT distinct_id)                              AS visitors
        FROM events
        WHERE timestamp >= ${from}
        GROUP BY identified`,
    },
  };
}
