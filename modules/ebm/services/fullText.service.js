// server/modules/ebm/services/fullText.service.js
//
// Полные тексты найденных работ — из собственного архива.
//
// ЗАЧЕМ. PubMed отдаёт только АННОТАЦИИ. Врач находит нужное исследование,
// читает десять строк — и упирается: чтобы прочитать работу, надо идти к
// издателю, а там половина за подпиской.
//
// При этом в архиве медицинской ленты (база DOCPATS_AI_NEWS) лежит около
// четырёх тысяч научных статей С ПОЛНЫМ ТЕКСТОМ, по 20-50 тысяч знаков —
// это журналы открытого доступа: PLOS, Frontiers, PeerJ, eLife. Замер на
// живой выдаче: из 25 свежих статей PLoS One, найденных в PubMed, восемь
// нашлись у нас целиком.
//
// Сопоставление идёт по DOI и PMID — постоянным идентификаторам работы, а не
// по названию: названия в разных базах различаются регистром, разметкой и
// хвостовой точкой, и совпадение по ним давало бы ложные срабатывания. Врачу
// нельзя открыть «полный текст» чужой статьи под правильным заголовком.

import mongoose from "mongoose";
import logger from "../../../common/logger.js";

const NEWS_DB_NAME = process.env.NEWS_DB_NAME || "DOCPATS_AI_NEWS";

// Адрес страницы материала на сайте. Тот же фронтенд, публичный раздел.
const READER_PATH = "/public/news/";

// Ниже этой длины «полным текстом» называть нечего — у нас лежит аннотация,
// и врач, кликнув, не получит больше, чем уже видит.
const MIN_USEFUL = 3000;

/** DOI регистронезависим по стандарту, но в базах хранится как пришёл. */
function doiVariants(doi) {
  const clean = String(doi || "").trim();
  if (!clean) return [];
  return [...new Set([clean, clean.toLowerCase(), clean.toUpperCase()])];
}

/**
 * Для каждой публикации PubMed ищет полный текст в своём архиве.
 *
 * Один запрос на весь список, а не на каждую работу: список приходит из
 * поиска по ступеням доказательности, там до трёх десятков публикаций.
 *
 * @param {Array<{pmid?: string, doi?: string}>} items
 * @returns {Promise<Map<string, {slug: string, length: number, url: string}>>}
 *   ключ — pmid или doi (в нижнем регистре) той же работы
 */
export async function findFullTexts(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return new Map();

  const dois = list.flatMap((i) => doiVariants(i.doi));
  const pmids = list.map((i) => String(i.pmid || "")).filter(Boolean);

  if (dois.length === 0 && pmids.length === 0) return new Map();

  const or = [];
  if (dois.length > 0) or.push({ doi: { $in: dois } });
  if (pmids.length > 0) or.push({ pmid: { $in: pmids } });

  try {
    // Архив живёт в отдельной базе того же кластера — читаем через тот же
    // клиент, как это уже делает генератор карты сайта.
    const db = mongoose.connection.getClient().db(NEWS_DB_NAME);

    const rows = await db
      .collection("news")
      .find(
        { status: "published", $or: or },
        { projection: { doi: 1, pmid: 1, slug: 1, content: 1, sourceName: 1 } },
      )
      .toArray();

    const found = new Map();

    for (const row of rows) {
      const length = String(row.content || "").length;
      // Аннотацию за полный текст не выдаём.
      if (length < MIN_USEFUL || !row.slug) continue;

      const entry = {
        slug: row.slug,
        length,
        source: row.sourceName || null,
        url: `${READER_PATH}${row.slug}`,
      };

      if (row.doi) found.set(String(row.doi).toLowerCase(), entry);
      if (row.pmid) found.set(String(row.pmid), entry);
    }

    return found;
  } catch (err) {
    // Архив недоступен — это не повод ронять поиск доказательств. Врач
    // получит выдачу PubMed без ссылок на полный текст, как и раньше.
    logger?.warn?.(
      { err: err.message, db: NEWS_DB_NAME },
      "ebm: архив полных текстов недоступен",
    );
    return new Map();
  }
}

/**
 * Проставляет публикациям ссылку на полный текст там, где он есть у нас.
 *
 * Меняет только два поля и ничего не удаляет: всё остальное в карточке
 * пришло из PubMed и должно остаться нетронутым.
 *
 * @param {Array<object>} items
 * @returns {Promise<Array<object>>}
 */
export async function attachFullTexts(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return list;

  const found = await findFullTexts(list);
  if (found.size === 0) return list;

  return list.map((item) => {
    const hit =
      (item.doi && found.get(String(item.doi).toLowerCase())) ||
      (item.pmid && found.get(String(item.pmid)));

    if (!hit) return item;

    return {
      ...item,
      // Читать можно здесь — без ухода к издателю и без подписки.
      fullTextUrl: hit.url,
      fullTextLength: hit.length,
    };
  });
}

export default { findFullTexts, attachFullTexts };
