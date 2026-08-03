// modules/analytics/queries/eventDetail.js
//
// Детализация ОДНОГО события: динамика, где происходит и — главное —
// разбивка по его собственным свойствам.
//
// ЗАЧЕМ ЭТО ОТДЕЛЬНО. Сводная таблица отвечает «arena_attempt_submitted
// случилось 120 раз». Это половина ответа: свойства события несут вторую
// половину — какая станция, сдал или нет, гость или врач. Раскладывать их
// по колонкам заранее нельзя: у каждого события свой набор свойств, а
// каталог событий пополняется (см. client/src/lib/events.js). Поэтому
// свойства разворачиваются на лету, из самого JSON.

import { since, safeDays, quote, TOP_LIMIT } from "./_shared.js";

// Служебные ключи, которые PostHog кладёт в properties сам. В разбивке по
// свойствам они только мешают: токен проекта одинаков у всех событий,
// distinct_id — это просто список посетителей, title остался в старых
// записях (сейчас он вырезается на клиенте).
const SERVICE_KEYS = "('token', 'distinct_id', 'title', 'lang')";

export function eventDetailQueries(eventName, days) {
  const from = since(days);
  const name = quote(eventName);

  return {
    // Сводка по событию.
    summary: {
      columns: ["count", "visitors", "sessions", "firstSeen", "lastSeen"],
      sql: `
        SELECT count()                                AS count,
               count(DISTINCT distinct_id)            AS visitors,
               count(DISTINCT properties.$session_id) AS sessions,
               -- Без событий min/max по пустому множеству отдают начало эпохи;
               -- «01.01.1970» на экране читается как настоящая дата, поэтому
               -- отдаём null и даём интерфейсу показать прочерк.
               if(count() > 0, min(timestamp), NULL)  AS firstSeen,
               if(count() > 0, max(timestamp), NULL)  AS lastSeen
        FROM events
        WHERE event = ${name} AND timestamp >= ${from}`,
    },

    // Динамика: когда началось, растёт ли, не отвалилось ли после релиза.
    daily: {
      columns: ["day", "count", "visitors"],
      sql: `
        SELECT toDate(timestamp)           AS day,
               count()                     AS count,
               count(DISTINCT distinct_id) AS visitors
        FROM events
        WHERE event = ${name} AND timestamp >= ${from}
        GROUP BY day
        ORDER BY day ASC`,
    },

    // Разбивка по СОБСТВЕННЫМ свойствам события — ради этого всё и затевалось.
    //
    // JSONExtractKeysAndValuesRaw разворачивает properties в пары «ключ —
    // значение». Обращаться надо к КОЛОНКЕ properties: properties.key отдал бы
    // одно поле, а нам нужен весь объект целиком. Значения приходят сырым
    // JSON, поэтому с них снимаются внешние кавычки.
    properties: {
      columns: ["key", "value", "count", "visitors"],
      sql: `
        SELECT tupleElement(kv, 1)                                        AS key,
               replaceRegexpAll(tupleElement(kv, 2), '^"|"$', '')         AS value,
               count()                                                    AS count,
               count(DISTINCT distinct_id)                                AS visitors
        FROM (
          SELECT arrayJoin(JSONExtractKeysAndValuesRaw(properties)) AS kv,
                 distinct_id                                        AS distinct_id
          FROM events
          WHERE event = ${name} AND timestamp >= ${from}
        )
        WHERE NOT startsWith(tupleElement(kv, 1), '$')
          AND tupleElement(kv, 1) NOT IN ${SERVICE_KEYS}
        GROUP BY key, value
        ORDER BY key ASC, count DESC
        LIMIT 300`,
    },

    // Из каких зон приложения событие приходит. Отвечает на вопрос
    // «этим пользуются в клинике или в поликлинике» для событий, которые
    // живут в обеих зонах.
    byZone: {
      columns: ["zone", "count", "visitors"],
      sql: `
        SELECT coalesce(properties.zone, '—')  AS zone,
               count()                         AS count,
               count(DISTINCT distinct_id)     AS visitors
        FROM events
        WHERE event = ${name} AND timestamp >= ${from}
        GROUP BY zone
        ORDER BY count DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // С каких экранов его вызывают.
    byScreen: {
      columns: ["screen", "count", "visitors"],
      sql: `
        SELECT coalesce(properties.path_template, properties.$pathname, '—') AS screen,
               count()                     AS count,
               count(DISTINCT distinct_id) AS visitors
        FROM events
        WHERE event = ${name} AND timestamp >= ${from}
        GROUP BY screen
        ORDER BY count DESC
        LIMIT ${TOP_LIMIT}`,
    },
  };
}

/**
 * Сводка по ВСЕМ продуктовым событиям с разворотом свойств — то, что
 * показывается на вкладке «События» без выбора конкретного.
 *
 * Отдельным запросом, а не циклом по событиям: одно обращение к PostHog
 * вместо сорока. Служебные события ($pageview, $web_vitals) исключены —
 * их разрезы уже есть на других вкладках.
 */
export function allCustomEventPropsQuery(days) {
  return {
    columns: ["event", "key", "value", "count"],
    sql: `
      SELECT event                                              AS event,
             tupleElement(kv, 1)                                AS key,
             replaceRegexpAll(tupleElement(kv, 2), '^"|"$', '')  AS value,
             count()                                            AS count
      FROM (
        SELECT event                                            AS event,
               arrayJoin(JSONExtractKeysAndValuesRaw(properties)) AS kv
        FROM events
        WHERE timestamp >= now() - INTERVAL ${safeDays(days)} DAY
          AND NOT startsWith(event, '$')
      )
      WHERE NOT startsWith(tupleElement(kv, 1), '$')
        AND tupleElement(kv, 1) NOT IN ${SERVICE_KEYS}
      GROUP BY event, key, value
      ORDER BY event ASC, key ASC, count DESC
      LIMIT 1000`,
  };
}
