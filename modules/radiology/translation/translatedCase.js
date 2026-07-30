// server/modules/radiology/translation/translatedCase.js
//
// Кейс на языке врача — и для показа, и для ОЦЕНКИ.
//
// ЗАЧЕМ ЭТО ОТДЕЛЬНЫЙ СЛОЙ. Перевести только видимый текст было бы хуже, чем
// не переводить вовсе. Оценка ответа в трёх станциях привязана к языку в двух
// местах:
//
//   diagnosisMatcher — сверяет диагноз врача со списком принятых формулировок
//     кейса построчно, намеренно без ИИ. Врач пишет «toplum kökenli pnömoni»,
//     в кейсе лежит «внебольничная пневмония» — ноль за диагноз;
//
//   impressionGrader — по умолчанию считает пересечение слов заключения врача
//     с эталоном автора. Между турецким и русским пересечение слов близко к
//     нулю — ноль за заключение.
//
// Вместе это две трети балла. Врач получил бы красивый кейс на своём языке и
// необъяснимые нули, причём выглядело бы это как работающая система.
//
// РЕШЕНИЕ: подменять кейс переводом ДО оценки, а не править места оценки.
// Скоринг читает caseDoc.impression.correctText и .diagnosisKeys — дадим ему
// их на нужном языке, и весь существующий код станет межъязычным без правок.
// Шесть мест вызова остаются нетронутыми, а значит и не могут разъехаться.

import ArenaCaseTranslation from "./arenaCaseTranslation.model.js";
import { applyCaseFields, sourceHashOf } from "./caseFields.js";
import logger from "../../../common/logger.js";

// Сколько ждать перевод, которого ещё нет, прежде чем отдать оригинал.
// Ноль или отрицательное значение выключает ожидание: перевод всё равно
// запустится, но врач получит оригинал сразу.
const LAZY_WAIT_MS = Number(process.env.ARENA_LAZY_TRANSLATION_WAIT_MS ?? 12000);
const LAZY_ENABLED = process.env.ARENA_LAZY_TRANSLATION !== "0";

/**
 * Поля перевода хранятся массивом {path, text} — ключи Map в mongoose не
 * умеют содержать точку. Для наложения удобнее карта, её и собираем.
 */
export function fieldsMapOf(translation) {
  const map = new Map();
  for (const row of translation?.fields ?? []) {
    if (row?.path) map.set(row.path, row.text ?? "");
  }
  return map;
}

/** Уникализация с сохранением порядка и без пустых строк. */
function mergeTerms(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const item of list ?? []) {
      const t = String(item ?? "").trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

/** Простая копия документа: на входе бывает и lean-объект, и документ Mongoose. */
function plain(doc) {
  const obj = typeof doc?.toObject === "function" ? doc.toObject() : doc;
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Накладывает перевод на кейс.
 *
 * Сверочные наборы диагноза ОБЪЕДИНЯЮТСЯ с оригинальными, а не заменяются.
 * Причина: врач, читающий кейс по-турецки, может написать диагноз и латиницей
 * — так принято, и авторские списки как раз содержат латинский термин.
 * Заменив набор, мы отняли бы у него верный ответ, который принимали до
 * перевода. Объединение может только расширить множество принятого, а
 * ошибочно принять чужой диагноз оно не даёт: термины разных языков для
 * разных болезней не совпадают.
 *
 * Объединяем с ЯЗЫКОМ ПОПЫТКИ, а не со всеми пятью: набор из пяти языков
 * принимал бы ответ на языке, которого врач в этом кейсе не видел, и превращал
 * бы список принятого в свалку.
 */
export function mergeCaseTranslation(caseType, caseDoc, translation) {
  if (!translation) return caseDoc;

  const view = plain(caseDoc);
  applyCaseFields(caseType, view, fieldsMapOf(translation));

  // Диагноз у станций лежит в разных полях: impression у снимков и анализов,
  // diagnosis у виртуального пациента.
  const node = caseType === "vp" ? view.diagnosis : view.impression;
  if (node) {
    node.diagnosisKeys = mergeTerms(node.diagnosisKeys, translation.diagnosisKeys);
    node.diagnosisSynonyms = mergeTerms(
      node.diagnosisSynonyms,
      translation.diagnosisSynonyms,
    );
  }

  return view;
}

/**
 * Нужно ли переводить кейс на этот язык прямо сейчас.
 *
 * Проверенный человеком перевод не устаревает автоматически: его правил
 * редактор, и подменять его машинным по несовпадению хеша означало бы стирать
 * ручную работу молча. Такой перевод обновляется только по кнопке «заново».
 */
function needsTranslation(caseType, caseDoc, translation) {
  if (!translation) return true;
  if (translation.status === "reviewed") return false;
  return translation.sourceHash !== sourceHashOf(caseType, caseDoc);
}

// Переводы, запущенные и ещё не завершённые: ключ → обещание.
//
// ЗАЧЕМ. Утром смену открывают десятки врачей, и первые из них попадают на один
// и тот же свежий кейс. Без этой карты каждый запустил бы свой перевод одного и
// того же кейса на один и тот же язык: десять запросов к модели вместо одного,
// оплаченных десять раз, и десять одновременных upsert в одну запись.
//
// Карта процессная, а не общая: при нескольких инстансах PM2 дубликат между
// инстансами возможен. Это осознанно — запись идемпотентна (upsert по
// caseType+caseId+lang), так что цена дубликата ровно одна: лишний вызов
// модели, а не испорченные данные. Заводить ради этого распределённую
// блокировку значило бы тащить Redis в путь чтения кейса.
const inFlight = new Map();

async function runTranslation(caseType, caseId, lang) {
  const { translateCase } = await import("./translateCase.service.js");
  await translateCase(caseType, caseId, { langs: [lang] });
  return ArenaCaseTranslation.findOne({ caseType, caseId, lang }).lean();
}

/**
 * Запускает перевод кейса на один язык — или присоединяется к уже идущему.
 *
 * Не бросает: отказ модели не должен ломать открытие кейса. Возвращает готовый
 * перевод или null.
 */
export function startCaseTranslation(caseType, caseId, lang) {
  const key = `${caseType}:${caseId}:${lang}`;
  let job = inFlight.get(key);
  if (job) return job;

  job = runTranslation(caseType, caseId, lang)
    .catch((err) => {
      logger?.warn?.(
        { err, caseType, caseId: String(caseId), lang },
        "lazy arena case translation failed",
      );
      return null;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, job);
  return job;
}

/**
 * Ждёт обещание не дольше ms. По истечении отдаёт null, НЕ отменяя работу:
 * перевод дойдёт до базы и следующее открытие кейса получит его сразу.
 */
function withTimeout(promise, ms) {
  if (!(ms > 0)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Кейс на нужном языке. Язык оригинала — отдаём как есть.
 *
 * ПЕРЕВОД ПО ТРЕБОВАНИЮ. Обычно перевод уже лежит в базе: он запускается при
 * публикации кейса. Но остаются два случая, когда его нет — кейсы,
 * опубликованные до появления перевода, и те, где модель тогда отказала. Раньше
 * врач в обоих получал русский текст, и никакая кнопка ему не помогала: кнопки
 * в интерфейсе нет. Теперь недостающий перевод запускается здесь же и, если
 * успевает, отдаётся сразу.
 *
 * Не бросает: отказ перевода — не повод не открыть кейс. Врач тогда видит
 * оригинал, а перевод доделывается в фоне и достаётся следующему.
 *
 * lazy ВКЛЮЧАЕТСЯ ЯВНО и только там, где кейс ПОКАЗЫВАЮТ (открытие кейса,
 * старт попытки). На путях ОЦЕНКИ он не нужен и был бы вреден: врач уже
 * ответил по тому тексту, который видел, и запускать там перевод значило бы
 * заставить его ждать модель на кнопке «сдать». Наборы диагноза при оценке и
 * так объединяются с оригинальными, так что отсутствие перевода не отнимает
 * балл за верный ответ.
 */
export async function translatedCaseFor(caseType, caseDoc, lang, { lazy = false } = {}) {
  if (!lang || !caseDoc) return caseDoc;
  const sourceLang = caseDoc.lang ?? "ru";
  if (lang === sourceLang) return caseDoc;

  let translation = await ArenaCaseTranslation.findOne({
    caseType,
    caseId: caseDoc._id,
    lang,
  }).lean();

  if (lazy && LAZY_ENABLED && needsTranslation(caseType, caseDoc, translation)) {
    const fresh = await withTimeout(
      startCaseTranslation(caseType, caseDoc._id, lang),
      LAZY_WAIT_MS,
    );
    if (fresh) translation = fresh;
  }

  return mergeCaseTranslation(caseType, caseDoc, translation);
}

/**
 * Каталог на языке врача: накладывает уже готовые переводы на страницу списка.
 *
 * ПЕРЕВОД ЗДЕСЬ НЕ ЗАПУСКАЕТСЯ, в отличие от открытия кейса. На странице 24
 * кейса, и запуск недостающих означал бы 24 параллельных обращения к модели на
 * один просмотр каталога — по цене и по времени это несоизмеримо с выигрышем:
 * в списке видно только название. Недостающее добирается бэкфиллом и первым
 * открытием кейса.
 *
 * Один запрос на всю страницу, а не по кейсу: список отдаётся постранично, и
 * запрос на элемент превратил бы каталог в N+1.
 */
export async function translateCaseList(caseType, items, lang) {
  if (!lang || !Array.isArray(items) || !items.length) return items;

  const foreign = items.filter((doc) => (doc?.lang ?? "ru") !== lang);
  if (!foreign.length) return items;

  const rows = await ArenaCaseTranslation.find({
    caseType,
    caseId: { $in: foreign.map((doc) => doc._id) },
    lang,
  })
    .select("caseId fields")
    .lean();
  if (!rows.length) return items;

  const byCase = new Map(rows.map((row) => [String(row.caseId), row]));
  return items.map((doc) => {
    const row = byCase.get(String(doc._id));
    return row ? mergeCaseTranslation(caseType, doc, row) : doc;
  });
}

/** Языки, на которых кейс уже доступен. Для витрины и админки. */
export async function availableLanguages(caseType, caseId) {
  const rows = await ArenaCaseTranslation.find({ caseType, caseId })
    .select("lang status")
    .lean();
  return rows.map((r) => ({ lang: r.lang, status: r.status }));
}
