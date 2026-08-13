// server/modules/ebm/services/evidence.service.js
//
// Отбор публикаций по силе доказательств.
//
// ЭТО И ЕСТЬ ОТЛИЧИЕ ОТ «ИИ ВЫСКАЗАЛ МНЕНИЕ». Доказательная медицина — не
// «найти статьи», а разложить найденное по дизайну исследования: мета-анализ
// весит иначе, чем описание случая. В PubMed тип публикации — ИНДЕКСИРОВАННОЕ
// поле, поэтому раскладка здесь машинная и воспроизводимая. Модель к ней не
// допускается: её дело начнётся позже — пересказать отобранное.
//
// ПОЧЕМУ ЭТО НЕ GRADE. Настоящая оценка по GRADE учитывает риск систематической
// ошибки, согласованность результатов, косвенность и точность — всё это требует
// чтения полных текстов человеком. Здесь мы говорим лишь о ТИПЕ ИСТОЧНИКА, и
// называть это уровнем доказательности было бы подлогом. Формулировка в ответе
// должна оставаться честной: «что нашлось и какого дизайна».

import { esearch, esummary } from "./pubmed.service.js";
import { attachFullTexts } from "./fullText.service.js";

/**
 * Ступени доказательности, от сильной к слабой.
 *
 * filter — синтаксис PubMed. [pt] это Publication Type, проставляемый
 * индексаторами NLM, а не автором статьи и не нами.
 */
export const EVIDENCE_LEVELS = Object.freeze([
  {
    key: "meta_analysis",
    title: "Мета-анализы",
    rank: 1,
    filter: '"meta-analysis"[pt]',
    note: "Количественное обобщение нескольких исследований",
  },
  {
    key: "systematic_review",
    title: "Систематические обзоры",
    rank: 2,
    filter: '"systematic review"[pt]',
    note: "Обзор по заранее заданному протоколу поиска",
  },
  {
    key: "guideline",
    title: "Клинические рекомендации",
    rank: 3,
    filter: '("practice guideline"[pt] OR "guideline"[pt])',
    note: "Позиция профессионального сообщества",
  },
  {
    key: "rct",
    title: "Рандомизированные исследования",
    rank: 4,
    filter: '"randomized controlled trial"[pt]',
    note: "Прямая проверка вмешательства",
  },
  {
    key: "observational",
    title: "Наблюдательные исследования",
    rank: 5,
    // Отдельного [pt] у когортных и случай-контроль нет — они размечены
    // предметными рубриками MeSH. Исключаем то, что уже попало в ступени выше,
    // иначе одна работа окажется сразу в двух разделах.
    filter:
      '("cohort studies"[mh] OR "case-control studies"[mh] OR "observational study"[pt]) NOT ("meta-analysis"[pt] OR "systematic review"[pt] OR "randomized controlled trial"[pt])',
    note: "Связь наблюдалась, но вмешательство не назначалось",
  },
]);

// Мнения, редакционные статьи и письма в ответ не идут вовсе: в иерархии
// доказательств они стоят ниже всего, а выглядят на странице так же
// убедительно, как мета-анализ. Показать их — значит уравнять.
const EXCLUDED = '(comment[pt] OR editorial[pt] OR letter[pt] OR "newspaper article"[pt])';

/**
 * Ищет доказательства по клиническому вопросу.
 *
 * @param {object} args
 * @param {string} args.term            запрос в синтаксисе PubMed
 * @param {number} [args.perLevel]      сколько работ показывать на ступени
 * @param {number} [args.yearsBack]     ограничить свежестью, 0 — без ограничения
 * @param {string[]} [args.levels]      какие ступени искать (по умолчанию все)
 * @returns {Promise<object>}
 */
export async function searchEvidence({
  term,
  perLevel = 5,
  yearsBack = 0,
  levels = null,
} = {}) {
  const clean = String(term || "").trim();
  if (clean.length < 3) {
    throw new Error("Слишком короткий запрос");
  }

  const wanted = levels
    ? EVIDENCE_LEVELS.filter((l) => levels.includes(l.key))
    : EVIDENCE_LEVELS;

  // ПЕРВЫМ ДЕЛОМ — голый запрос, без единого фильтра.
  //
  // Здесь была ошибка, которую стоит описать, потому что она не выглядит
  // ошибкой. PubMed не сообщает, что не понял слово, — он молча его
  // выбрасывает. Русский запрос теряется целиком, скобка «(запрос)» становится
  // ПУСТОЙ, и выражение «(пусто) NOT комментарии» означает уже не «ничего», а
  // «вся база минус комментарии». Проверка на живом PubMed: бессмысленная
  // фраза по-русски дала 2 447 841 публикацию, среди них 1962 «мета-анализа» —
  // и всё это настоящие работы с настоящими PMID, просто не по вопросу врача.
  // Хуже пустого ответа: выглядит как ответ.
  //
  // Голый запрос на ту же фразу даёт честный ноль. Поэтому спрашиваем сначала
  // его: пока не убедились, что PubMed понял хоть одно слово, фильтры не
  // приклеиваем. Заодно это дешевле — на пустой теме уходит один запрос
  // вместо шести.
  const probe = { term: clean, ...(await esearch(clean, { limit: 1 })) };

  if (probe.count === 0) {
    return {
      query: clean,
      totalAnyDesign: 0,
      notUnderstood: probe.notFound,
      levels: [],
      verdict: buildVerdict(0, [], null, probe),
    };
  }

  const period =
    yearsBack > 0 ? ` AND ("last ${yearsBack} years"[dp])` : "";
  const base = `(${clean})${period} NOT ${EXCLUDED}`;

  // Сколько всего есть по вопросу — уже с исключением мнений и с учётом
  // периода. Отдельная величина: по ней видно, пуста ли тема вообще или
  // просто нет сильных дизайнов.
  const overall = await esearch(base, { limit: 1 });

  const found = [];
  for (const level of wanted) {
    // Последовательно, а не параллельно: у NCBI ограничение по частоте, и
    // веерный запуск пяти запросов упрётся в него на первом же обращении.
    const { count, ids } = await esearch(`${base} AND ${level.filter}`, {
      limit: perLevel,
    });

    const raw = count > 0 ? await esummary(ids) : [];

    // Где работа есть в нашем архиве целиком — врач прочитает её здесь.
    // PubMed отдаёт только аннотации, и без этого шага каждый переход к
    // полному тексту ведёт к издателю, а там половина за подпиской.
    const items = await attachFullTexts(raw);

    found.push({
      key: level.key,
      title: level.title,
      rank: level.rank,
      note: level.note,
      total: count,
      items,
    });
  }

  const strongest = found.find((l) => l.total > 0) || null;

  return {
    query: base,
    totalAnyDesign: overall.count,
    // Слова, которых PubMed не знает. Показываем их врачу: чаще всего это
    // русское название, и тогда понятно, почему нашлось мало.
    notUnderstood: probe.notFound,
    levels: found,
    // Итог одной строкой — то, с чего врач начнёт читать.
    verdict: buildVerdict(overall.count, found, strongest, probe),
  };
}

/** В строке есть кириллица — PubMed индексирован только по-английски. */
function hasCyrillic(value) {
  return /[Ѐ-ӿ]/.test(String(value || ""));
}

/**
 * Честная сводка о ПОЛНОТЕ доказательств — не об эффективности.
 *
 * Отдельно проговорено, потому что соблазн велик: система, которая ищет
 * доказательства, легко начинает выглядеть системой, которая делает выводы.
 * Здесь говорится только «что найдено», а не «работает или нет».
 */
function buildVerdict(totalAnyDesign, levels, strongest, probe = null) {
  if (totalAnyDesign === 0) {
    // Разделяем два очень разных случая. «PubMed не понял запрос» — это про
    // формулировку, и молчать об этом нельзя: врач решит, что доказательств
    // нет, тогда как их просто не искали.
    //
    // Кириллицу определяем по САМОМУ запросу, а не по списку непонятых слов:
    // на полностью русскую фразу PubMed возвращает пустой phrasesnotfound и
    // ноль находок — сказать, чего именно он не понял, ему нечем.
    if (hasCyrillic(probe?.term)) {
      return {
        kind: "not_understood",
        text: "PubMed не распознал запрос — он индексирован только по-английски. Повторите вопрос английскими терминами: например, «metformin prediabetes» вместо «метформин преддиабет».",
      };
    }
    if (probe?.notFound?.length > 0) {
      return {
        kind: "not_understood",
        text: `PubMed не знает: ${probe.notFound.join(", ")}. Проверьте написание или подберите синоним — возможно, термин называется иначе.`,
      };
    }
    return {
      kind: "nothing",
      text: "По этому запросу в PubMed нет публикаций. Проверьте формулировку — возможно, стоит использовать английские термины или синонимы.",
    };
  }

  const strongTotal = levels
    .filter((l) => l.rank <= 3)
    .reduce((sum, l) => sum + l.total, 0);

  if (strongTotal === 0) {
    const rct = levels.find((l) => l.key === "rct");
    if (rct?.total > 0) {
      return {
        kind: "trials_only",
        text: `Обобщающих работ (мета-анализов, систематических обзоров, рекомендаций) нет. Есть ${rct.total} рандомизированных исследований — вывод придётся делать по ним самим.`,
      };
    }
    return {
      kind: "weak",
      text: `Ни обобщающих работ, ни рандомизированных исследований не найдено. Всего публикаций по теме: ${totalAnyDesign} — это уровень наблюдений и отдельных сообщений, для клинического решения слабое основание.`,
    };
  }

  return {
    kind: "strong",
    text: `Найдено ${strongTotal} обобщающих работ высокого уровня (${strongest.title.toLowerCase()} и далее). Всего по теме: ${totalAnyDesign} публикаций.`,
  };
}

export default { searchEvidence, EVIDENCE_LEVELS };
