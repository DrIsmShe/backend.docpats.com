// modules/analytics/queries/performance.js
//
// Вкладка «Скорость»: Core Web Vitals по экранам.
//
// PostHog шлёт событие $web_vitals сам, отдельным потоком, и выключить его
// через capture_pageview нельзя. Раз оно всё равно собирается — пусть от
// него будет польза: у приложения нет ленивой загрузки и один бандл на
// ~560 маршрутов, так что LCP тут величина не теоретическая.
//
// Пороговые значения — стандартные для Web Vitals:
//   LCP  хорошо ≤ 2.5 с,  плохо > 4 с
//   FCP  хорошо ≤ 1.8 с,  плохо > 3 с
//   INP  хорошо ≤ 200 мс, плохо > 500 мс
//   CLS  хорошо ≤ 0.1,    плохо > 0.25
// Ориентироваться нужно на 75-й процентиль, а не на среднее: среднее
// прячет хвост, в котором и сидят недовольные пользователи.

import { since, TOP_LIMIT } from "./_shared.js";

export function performanceQueries(days) {
  const from = since(days);

  // Сводка по одной метрике: сколько замеров, медиана, p75, p95.
  const metric = (name) => ({
    columns: ["samples", "median", "p75", "p95", "worst"],
    sql: `
      SELECT count()                                              AS samples,
             round(median(toFloat(properties.$web_vitals_${name}_value)), 3)          AS median,
             round(quantile(0.75)(toFloat(properties.$web_vitals_${name}_value)), 3)  AS p75,
             round(quantile(0.95)(toFloat(properties.$web_vitals_${name}_value)), 3)  AS p95,
             round(max(toFloat(properties.$web_vitals_${name}_value)), 3)             AS worst
      FROM events
      WHERE timestamp >= ${from} AND properties.$web_vitals_${name}_value IS NOT NULL`,
  });

  return {
    lcp: metric("LCP"),
    fcp: metric("FCP"),
    inp: metric("INP"),
    cls: metric("CLS"),
    ttfb: metric("TTFB"),

    // Разрез по экранам: где именно тормозит. Сортировка по p75 LCP —
    // худшие сверху, это и есть список на оптимизацию.
    byScreen: {
      columns: ["screen", "samples", "lcpP75", "fcpP75", "inpP75", "clsP75"],
      sql: `
        SELECT coalesce(properties.path_template, properties.$pathname, '—') AS screen,
               count() AS samples,
               round(quantile(0.75)(toFloat(properties.$web_vitals_LCP_value)), 0) AS lcpP75,
               round(quantile(0.75)(toFloat(properties.$web_vitals_FCP_value)), 0) AS fcpP75,
               round(quantile(0.75)(toFloat(properties.$web_vitals_INP_value)), 0) AS inpP75,
               round(quantile(0.75)(toFloat(properties.$web_vitals_CLS_value)), 3) AS clsP75
        FROM events
        WHERE timestamp >= ${from} AND event = '$web_vitals'
        GROUP BY screen
        HAVING samples > 0
        ORDER BY lcpP75 DESC
        LIMIT ${TOP_LIMIT}`,
    },

    // Динамика LCP по дням: стало ли хуже после релиза.
    lcpDaily: {
      columns: ["day", "samples", "p75"],
      sql: `
        SELECT toDate(timestamp) AS day,
               count()           AS samples,
               round(quantile(0.75)(toFloat(properties.$web_vitals_LCP_value)), 0) AS p75
        FROM events
        WHERE timestamp >= ${from} AND properties.$web_vitals_LCP_value IS NOT NULL
        GROUP BY day
        ORDER BY day ASC`,
    },

    // Скорость в разрезе устройств: на телефоне картина всегда другая.
    byDevice: {
      columns: ["deviceType", "samples", "lcpP75", "inpP75"],
      sql: `
        SELECT coalesce(properties.$device_type, '—') AS deviceType,
               count() AS samples,
               round(quantile(0.75)(toFloat(properties.$web_vitals_LCP_value)), 0) AS lcpP75,
               round(quantile(0.75)(toFloat(properties.$web_vitals_INP_value)), 0) AS inpP75
        FROM events
        WHERE timestamp >= ${from} AND event = '$web_vitals'
        GROUP BY deviceType
        ORDER BY samples DESC`,
    },

    // Сколько времени уходит на инициализацию SDK — косвенный признак
    // тяжести стартового бандла.
    initTime: {
      columns: ["samples", "medianMs", "p95Ms"],
      sql: `
        SELECT count()                                                        AS samples,
               round(median(toFloat(properties.$initialization_time)), 0)      AS medianMs,
               round(quantile(0.95)(toFloat(properties.$initialization_time)), 0) AS p95Ms
        FROM events
        WHERE timestamp >= ${from} AND properties.$initialization_time IS NOT NULL`,
    },
  };
}
