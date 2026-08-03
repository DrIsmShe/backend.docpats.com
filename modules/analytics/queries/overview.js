// modules/analytics/queries/overview.js
//
// Вкладка «Обзор»: ключевые числа за период, сравнение с предыдущим таким же
// периодом и разрезы по времени (дни, часы, дни недели).
//
// Сессия здесь считается агрегацией событий по $session_id, а не берётся из
// таблицы sessions: так расчёт не зависит от того, включена ли у проекта
// сессионная аналитика, и одинаково работает на любом тарифе.

import { since, prevSince } from "./_shared.js";

export function overviewQueries(days) {
  const from = since(days);
  const prevFrom = prevSince(days);

  return {
    // Главные числа периода.
    kpi: {
      columns: ["events", "visitors", "sessions", "pageviews", "screens"],
      sql: `
        SELECT count()                                             AS events,
               count(DISTINCT distinct_id)                         AS visitors,
               count(DISTINCT properties.$session_id)              AS sessions,
               countIf(event = '$pageview')                        AS pageviews,
               count(DISTINCT properties.path_template)            AS screens
        FROM events
        WHERE timestamp >= ${from}`,
    },

    // Те же числа за предыдущий отрезок той же длины — чтобы показать
    // стрелку роста. Верхняя граница обязательна, иначе попадёт текущий.
    kpiPrev: {
      columns: ["events", "visitors", "sessions", "pageviews"],
      sql: `
        SELECT count()                                AS events,
               count(DISTINCT distinct_id)            AS visitors,
               count(DISTINCT properties.$session_id) AS sessions,
               countIf(event = '$pageview')           AS pageviews
        FROM events
        WHERE timestamp >= ${prevFrom} AND timestamp < ${from}`,
    },

    // Поведение сессий: длительность, глубина, доля отказов.
    // Отказ = сессия ровно с одним просмотром экрана.
    sessions: {
      columns: ["sessions", "avgDurationSec", "medianDurationSec", "avgPageviews", "bounceRate"],
      sql: `
        SELECT count()                              AS sessions,
               round(avg(duration))                 AS avgDurationSec,
               round(median(duration))              AS medianDurationSec,
               round(avg(views), 2)                 AS avgPageviews,
               round(countIf(views <= 1) / count(), 4) AS bounceRate
        FROM (
          SELECT properties.$session_id                              AS sid,
                 dateDiff('second', min(timestamp), max(timestamp))  AS duration,
                 countIf(event = '$pageview')                        AS views
          FROM events
          WHERE timestamp >= ${from} AND properties.$session_id IS NOT NULL
          GROUP BY sid
        )`,
    },

    // Динамика по дням — основной график вкладки.
    daily: {
      columns: ["day", "events", "visitors", "sessions", "pageviews"],
      sql: `
        SELECT toDate(timestamp)                      AS day,
               count()                                AS events,
               count(DISTINCT distinct_id)            AS visitors,
               count(DISTINCT properties.$session_id) AS sessions,
               countIf(event = '$pageview')           AS pageviews
        FROM events
        WHERE timestamp >= ${from}
        GROUP BY day
        ORDER BY day ASC`,
    },

    // Часы суток: когда врачи реально сидят в системе. Время серверное (UTC).
    byHour: {
      columns: ["hour", "events", "visitors"],
      sql: `
        SELECT toHour(timestamp)           AS hour,
               count()                     AS events,
               count(DISTINCT distinct_id) AS visitors
        FROM events
        WHERE timestamp >= ${from}
        GROUP BY hour
        ORDER BY hour ASC`,
    },

    // Дни недели: 1 — понедельник, 7 — воскресенье.
    byWeekday: {
      columns: ["weekday", "events", "visitors"],
      sql: `
        SELECT toDayOfWeek(timestamp)      AS weekday,
               count()                     AS events,
               count(DISTINCT distinct_id) AS visitors
        FROM events
        WHERE timestamp >= ${from}
        GROUP BY weekday
        ORDER BY weekday ASC`,
    },

    // Новые против вернувшихся: новым считается посетитель, у которого первое
    // событие вообще (за всю историю) попало в этот период.
    newVsReturning: {
      columns: ["kind", "visitors"],
      sql: `
        SELECT if(firstSeen >= ${from}, 'new', 'returning') AS kind,
               count()                                      AS visitors
        FROM (
          SELECT distinct_id, min(timestamp) AS firstSeen
          FROM events
          GROUP BY distinct_id
          HAVING max(timestamp) >= ${from}
        )
        GROUP BY kind`,
    },

    // Границы данных: с какого момента вообще что-то есть. Отвечает на
    // вопрос «пусто, потому что нет трафика, или потому что счётчик молчит».
    coverage: {
      columns: ["firstEvent", "lastEvent", "eventsAllTime", "visitorsAllTime"],
      sql: `
        SELECT min(timestamp)              AS firstEvent,
               max(timestamp)              AS lastEvent,
               count()                     AS eventsAllTime,
               count(DISTINCT distinct_id) AS visitorsAllTime
        FROM events`,
    },
  };
}
