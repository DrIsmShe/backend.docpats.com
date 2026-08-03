// modules/analytics/queries/behavior.js
//
// Вкладка «События»: что вообще происходит в системе и возвращаются ли люди.
//
// Пока клиент шлёт только $pageview (плюс служебные события SDK), таблица
// событий будет короткой. Она же и покажет, когда в код добавят вызовы
// track() — новые имена появятся здесь сами, без правок дашборда.

import { since, TOP_LIMIT } from "./_shared.js";

export function behaviorQueries(days) {
  const from = since(days);

  return {
    // Все типы событий: и свои, и автоматические.
    events: {
      columns: ["event", "count", "visitors", "sessions", "lastSeen"],
      sql: `
        SELECT event                                  AS event,
               count()                                AS count,
               count(DISTINCT distinct_id)            AS visitors,
               count(DISTINCT properties.$session_id) AS sessions,
               max(timestamp)                         AS lastSeen
        FROM events
        WHERE timestamp >= ${from}
        GROUP BY event
        ORDER BY count DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Динамика по дням для каждого типа события — видно, когда что
    // появилось и не отвалилось ли.
    eventsDaily: {
      columns: ["day", "event", "count"],
      sql: `
        SELECT toDate(timestamp) AS day, event AS event, count() AS count
        FROM events
        WHERE timestamp >= ${from}
        GROUP BY day, event
        ORDER BY day ASC, count DESC`,
    },

    // Собственные (не служебные) события крупным планом: именно они
    // отвечают на вопрос «каким функционалом пользуются».
    customEvents: {
      columns: ["event", "count", "visitors"],
      sql: `
        SELECT event AS event, count() AS count, count(DISTINCT distinct_id) AS visitors
        FROM events
        WHERE timestamp >= ${from} AND NOT startsWith(event, '$')
        GROUP BY event
        ORDER BY count DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Возвращаемость по неделям: сколько из пришедших на неделе N были
    // активны через 1, 2, 3… недели. Классическая когорта удержания.
    retention: {
      columns: ["cohortWeek", "weeksLater", "visitors"],
      sql: `
        SELECT toStartOfWeek(firstSeen)                         AS cohortWeek,
               dateDiff('week', toStartOfWeek(firstSeen), toStartOfWeek(timestamp)) AS weeksLater,
               count(DISTINCT distinct_id)                      AS visitors
        FROM (
          SELECT e.distinct_id AS distinct_id,
                 e.timestamp   AS timestamp,
                 f.firstSeen   AS firstSeen
          FROM events AS e
          INNER JOIN (
            SELECT distinct_id, min(timestamp) AS firstSeen
            FROM events
            GROUP BY distinct_id
          ) AS f ON e.distinct_id = f.distinct_id
          WHERE e.timestamp >= ${from} AND f.firstSeen >= ${from}
        )
        GROUP BY cohortWeek, weeksLater
        ORDER BY cohortWeek ASC, weeksLater ASC`,
    },

    // Ошибки фронтенда, если когда-нибудь включат error tracking.
    // Сейчас блок вернёт пусто — и это ожидаемо.
    exceptions: {
      columns: ["message", "count", "visitors", "lastSeen"],
      sql: `
        SELECT coalesce(properties.$exception_message, properties.$exception_type, '—') AS message,
               count()                     AS count,
               count(DISTINCT distinct_id) AS visitors,
               max(timestamp)              AS lastSeen
        FROM events
        WHERE timestamp >= ${from} AND event = '$exception'
        GROUP BY message
        ORDER BY count DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Флаги функциональности: какие включены и кому достались.
    //
    // Массив флагов лежит в properties JSON-строкой, поэтому обращаться
    // надо к КОЛОНКЕ properties с именем ключа: properties.$active_feature_flags
    // отдаёт Nullable(String), и arrayJoin по нему падает.
    featureFlags: {
      columns: ["flag", "events"],
      sql: `
        SELECT replaceRegexpAll(
                 arrayJoin(JSONExtractArrayRaw(properties, '$active_feature_flags')),
                 '^"|"$', ''
               )       AS flag,
               count() AS events
        FROM events
        WHERE timestamp >= ${from}
        GROUP BY flag
        ORDER BY events DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Версия SDK на клиентах: расходится — значит у кого-то в браузере
    // висит старая сборка приложения.
    sdkVersions: {
      columns: ["lib", "version", "events"],
      sql: `
        SELECT coalesce(properties.$lib, '—')                  AS lib,
               coalesce(toString(properties.$lib_version), '—') AS version,
               count()                                          AS events
        FROM events
        WHERE timestamp >= ${from}
        GROUP BY lib, version
        ORDER BY events DESC
        LIMIT ${TOP_LIMIT}`,
    },
  };
}
