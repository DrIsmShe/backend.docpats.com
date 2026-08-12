// server/modules/ebm/services/pubmed.service.js
//
// Клиент к PubMed (NCBI E-utilities).
//
// ЗАЧЕМ ОТДЕЛЬНЫМ СЛОЕМ. Это единственное место, где модуль доказательной
// медицины разговаривает с внешним миром. Всё, что выше, работает уже с
// готовыми записями — и не может ничего выдумать, потому что придумывать
// нечего: названия, журналы, годы и идентификаторы приходят из PubMed.
//
// Почему это важно именно здесь. Сегодняшний замер по сгенерированным статьям:
// из 80 ссылок, написанных моделью по памяти, 14 указывали на несуществующие
// работы, а 20 — на чужие. Для статьи это стыдно, для доказательной медицины
// недопустимо: врач может назначить препарат. Поэтому модель к поиску не
// допускается вовсе.
//
// ОГРАНИЧЕНИЯ NCBI. Без ключа — 3 запроса в секунду, с бесплатным ключом — 10.
// Превышение даёт 429 и, при упорстве, блокировку адреса. Ограничитель здесь
// общий на процесс: он нужен не для вежливости, а чтобы не потерять доступ.

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TIMEOUT_MS = Number(process.env.PUBMED_TIMEOUT_MS ?? 20000);

// NCBI просит представляться: по этим полям с нами свяжутся, если запросы
// начнут мешать, вместо того чтобы молча заблокировать.
const TOOL = "docpats-ebm";
const EMAIL = process.env.PUBMED_CONTACT_EMAIL || "info@docpats.com";
const API_KEY = process.env.PUBMED_API_KEY || "";

// Минимальный промежуток между запросами. С запасом от разрешённого: 3/с без
// ключа означает «не чаще», а не «ровно», и NCBI считает по своему таймеру, не
// по нашему. На 350 мс (2,85/с) живой прогон словил 429 — берём 500.
//
// Ключ бесплатный и поднимает лимит втрое; при заметной нагрузке он нужен —
// см. PUBMED_API_KEY в README модуля.
// В тестах PubMed замокан, живых обращений нет — ограничивать нечего, а
// полсекунды на вызов растягивают прогон до минуты на пустом месте.
const MIN_GAP_MS =
  process.env.NODE_ENV === "test" ? 0 : API_KEY ? 120 : 500;

// Пауза перед единственным повтором после 429. NCBI считает частоту скользящим
// окном, поэтому короткого выдоха хватает.
const RETRY_AFTER_429_MS = 2500;

let lastCall = 0;

// Очередь на промисах, а не просто отметка времени.
//
// Наивная версия («посчитать паузу, поспать, записать lastCall») ломается на
// параллельных вызовах: все они читают ОДНО значение lastCall до того, как его
// успел обновить первый, вычисляют одинаковую паузу и уходят в NCBI разом —
// ограничитель есть, а ограничения нет. Здесь каждый вызов ждёт предыдущего.
let queue = Promise.resolve();

function throttle() {
  const turn = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
  });
  // Свой хвост очереди не должен падать из-за чужой ошибки.
  queue = turn.catch(() => {});
  return turn;
}

function withCommonParams(params) {
  const search = new URLSearchParams(params);
  search.set("tool", TOOL);
  search.set("email", EMAIL);
  if (API_KEY) search.set("api_key", API_KEY);
  return search;
}

async function callEutils(endpoint, params, { retryOn429 = true } = {}) {
  await throttle();

  const url = `${EUTILS}/${endpoint}?${withCommonParams(params).toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

  if (res.status === 429) {
    // Один повтор, а не отказ. Раскладка по ступеням — это шесть обращений
    // подряд; уронить весь ответ врача из-за того, что NCBI притормозил на
    // одном из них, несоразмерно. Повтор ровно один: упорство при 429 ведёт
    // к блокировке адреса, а её снимать долго и вручную.
    if (retryOn429) {
      await new Promise((r) => setTimeout(r, RETRY_AFTER_429_MS));
      return callEutils(endpoint, params, { retryOn429: false });
    }
    throw new Error("PubMed ограничил частоту запросов — попробуйте через минуту");
  }
  if (!res.ok) {
    throw new Error(`PubMed ответил ${res.status}`);
  }

  return res.json();
}

/**
 * Поиск идентификаторов публикаций.
 *
 * @param {string} term  запрос в синтаксисе PubMed
 * @param {object} [opts]
 * @param {number} [opts.limit]  сколько идентификаторов вернуть
 * @param {string} [opts.sort]   relevance | pub_date
 * @returns {Promise<{count: number, ids: string[], translation: string, notFound: string[]}>}
 *   count — сколько ВСЕГО нашлось, а не сколько вернули: это отдельная и
 *   важная величина, по ней видно, есть ли по вопросу литература вообще.
 *   translation — как PubMed ПОНЯЛ запрос (он раскрывает синонимы и рубрики
 *   MeSH сам). notFound — слова, которых он не знает.
 *
 *   Последние два поля нужны не для отладки. PubMed не сообщает об ошибке,
 *   когда не понял слово: он молча его выбрасывает. Русский запрос теряется
 *   целиком, и без этих полей потерю не отличить от честного «ничего нет».
 */
export async function esearch(term, { limit = 10, sort = "relevance" } = {}) {
  const data = await callEutils("esearch.fcgi", {
    db: "pubmed",
    retmode: "json",
    retmax: String(limit),
    sort,
    term,
  });

  const result = data?.esearchresult;
  if (result?.ERROR) throw new Error(`PubMed: ${result.ERROR}`);

  return {
    count: Number(result?.count ?? 0),
    ids: Array.isArray(result?.idlist) ? result.idlist : [],
    translation: String(result?.querytranslation || "").trim(),
    notFound: [
      ...(result?.errorlist?.phrasesnotfound || []),
      ...(result?.warninglist?.phrasesignored || []),
    ],
  };
}

/**
 * Карточки публикаций по идентификаторам.
 *
 * Возвращает ровно то, что отдал PubMed, приведённое к плоскому виду. Никаких
 * домыслов: чего в ответе нет — того нет и здесь.
 */
export async function esummary(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const data = await callEutils("esummary.fcgi", {
    db: "pubmed",
    retmode: "json",
    id: ids.join(","),
  });

  return ids
    .map((id) => data?.result?.[id])
    .filter(Boolean)
    .map(normalizeSummary);
}

/**
 * @param {object} raw карточка из esummary
 */
function normalizeSummary(raw) {
  const articleIds = Array.isArray(raw.articleids) ? raw.articleids : [];
  const idOf = (type) =>
    articleIds.find((a) => a.idtype === type)?.value || null;

  // Год берём из pubdate: там встречается и «2023», и «2023 Apr 15», и
  // «2023 Spring». Первые четыре цифры — единственное, на что можно опереться.
  const yearMatch = String(raw.pubdate || "").match(/\d{4}/);

  return {
    pmid: String(raw.uid),
    title: stripTags(raw.title),
    journal: raw.fulljournalname || raw.source || null,
    year: yearMatch ? Number(yearMatch[0]) : null,
    authors: (raw.authors || [])
      .filter((a) => a.authtype === "Author")
      .map((a) => a.name)
      .slice(0, 8),
    // DOI есть НЕ у всего: у работ до эпохи DOI его просто не существует.
    // Поэтому основная ссылка строится по PMID, который есть у всего в PubMed.
    doi: idOf("doi"),
    url: `https://pubmed.ncbi.nlm.nih.gov/${raw.uid}/`,
    doiUrl: idOf("doi") ? `https://doi.org/${idOf("doi")}` : null,
    publicationTypes: Array.isArray(raw.pubtype) ? raw.pubtype : [],
    // «Ahead of print» — работа принята, но ещё не вышла в номере. Для врача
    // это важно: данные свежие, но окончательная версия может отличаться.
    aheadOfPrint: /aheadofprint/i.test(String(raw.pubstatus || "")),
  };
}

/** Заголовки PubMed приходят с разметкой вроде <i>Escherichia coli</i>. */
function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default { esearch, esummary };
