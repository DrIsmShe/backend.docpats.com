// modules/analytics/queries/pages.js
//
// Вкладка «Экраны»: что именно открывают. Ради этого вопроса счётчик и
// заводился — в приложении около 560 маршрутов, и до появления аналитики
// не было способа узнать, какие из них живые.
//
// Везде группируем по path_template (шаблону пути), а не по сырому адресу:
// иначе каждый пациент давал бы отдельную «страницу». См. клиентский
// analytics.js — там же объяснено, почему идентификаторы не уходят наружу.

import { since, TOP_LIMIT } from "./_shared.js";

export function pagesQueries(days) {
  const from = since(days);

  return {
    // Крупная группировка поверх всех маршрутов: клиника, врач, арена…
    zones: {
      columns: ["zone", "pageviews", "visitors", "sessions"],
      sql: `
        SELECT coalesce(properties.zone, '—')         AS zone,
               count()                                AS pageviews,
               count(DISTINCT distinct_id)            AS visitors,
               count(DISTINCT properties.$session_id) AS sessions
        FROM events
        WHERE event = '$pageview' AND timestamp >= ${from}
        GROUP BY zone
        ORDER BY pageviews DESC`,
    },

    // Полный список экранов. Лимит высокий намеренно: это главная таблица
    // вкладки, и обрезать её на десятке значит не ответить на вопрос.
    screens: {
      columns: ["screen", "zone", "pageviews", "visitors", "sessions"],
      sql: `
        SELECT coalesce(properties.path_template, properties.$pathname, '—') AS screen,
               any(properties.zone)                   AS zone,
               count()                                AS pageviews,
               count(DISTINCT distinct_id)            AS visitors,
               count(DISTINCT properties.$session_id) AS sessions
        FROM events
        WHERE event = '$pageview' AND timestamp >= ${from}
        GROUP BY screen
        ORDER BY pageviews DESC
        LIMIT 200`,
    },

    // С чего начинают работу.
    entryPages: {
      columns: ["screen", "sessions"],
      sql: `
        SELECT entry AS screen, count() AS sessions
        FROM (
          SELECT properties.$session_id AS sid,
                 argMin(coalesce(properties.path_template, properties.$pathname), timestamp) AS entry
          FROM events
          WHERE event = '$pageview' AND timestamp >= ${from}
            AND properties.$session_id IS NOT NULL
          GROUP BY sid
        )
        GROUP BY screen
        ORDER BY sessions DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Где заканчивают. Экран с большой долей выходов — либо тупик в
    // сценарии, либо, наоборот, целевое действие.
    exitPages: {
      columns: ["screen", "sessions"],
      sql: `
        SELECT exitScreen AS screen, count() AS sessions
        FROM (
          SELECT properties.$session_id AS sid,
                 argMax(coalesce(properties.path_template, properties.$pathname), timestamp) AS exitScreen
          FROM events
          WHERE event = '$pageview' AND timestamp >= ${from}
            AND properties.$session_id IS NOT NULL
          GROUP BY sid
        )
        GROUP BY screen
        ORDER BY sessions DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Время на экране и глубина прокрутки.
    //
    // ОТКУДА ЦИФРЫ. Событие $pageleave отключено (оно ничего не даёт, кроме
    // лишнего трафика), поэтому длительность приходит задним числом: SDK
    // прикладывает $prev_pageview_* к СЛЕДУЮЩЕМУ просмотру. Отсюда важное
    // следствие — последний экран сессии в эту статистику не попадает.
    engagement: {
      columns: ["screen", "samples", "avgSeconds", "medianSeconds", "avgScrollPct"],
      sql: `
        SELECT properties.$prev_pageview_pathname                       AS screen,
               count()                                                  AS samples,
               round(avg(toFloat(properties.$prev_pageview_duration)))   AS avgSeconds,
               round(median(toFloat(properties.$prev_pageview_duration))) AS medianSeconds,
               round(avg(toFloat(properties.$prev_pageview_max_scroll_percentage)) * 100) AS avgScrollPct
        FROM events
        WHERE timestamp >= ${from}
          AND properties.$prev_pageview_pathname IS NOT NULL
        GROUP BY screen
        ORDER BY samples DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Переходы между экранами: откуда куда идут. Готовый граф навигации.
    transitions: {
      columns: ["from", "to", "count"],
      sql: `
        SELECT properties.$prev_pageview_pathname AS "from",
               coalesce(properties.path_template, properties.$pathname) AS "to",
               count() AS count
        FROM events
        WHERE event = '$pageview' AND timestamp >= ${from}
          AND properties.$prev_pageview_pathname IS NOT NULL
        GROUP BY "from", "to"
        ORDER BY count DESC
        LIMIT ${TOP_LIMIT}`,
    },
  };
}
