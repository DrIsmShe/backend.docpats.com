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
import { applyCaseFields } from "./caseFields.js";

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
 * Кейс на нужном языке. Нет перевода или язык оригинала — отдаём как есть.
 *
 * Не бросает: отсутствие перевода — это не ошибка, а обычное состояние
 * свежего кейса. Врач в таком случае видит оригинал, и это правильнее, чем
 * отказ открыть кейс.
 */
export async function translatedCaseFor(caseType, caseDoc, lang) {
  if (!lang || !caseDoc) return caseDoc;
  const sourceLang = caseDoc.lang ?? "ru";
  if (lang === sourceLang) return caseDoc;

  const translation = await ArenaCaseTranslation.findOne({
    caseType,
    caseId: caseDoc._id,
    lang,
  }).lean();

  return mergeCaseTranslation(caseType, caseDoc, translation);
}

/** Языки, на которых кейс уже доступен. Для витрины и админки. */
export async function availableLanguages(caseType, caseId) {
  const rows = await ArenaCaseTranslation.find({ caseType, caseId })
    .select("lang status")
    .lean();
  return rows.map((r) => ({ lang: r.lang, status: r.status }));
}
