// common/services/citationCheck.service.js
//
// Проверка списка литературы по реестру Crossref.
//
// ЗАЧЕМ. Модель пишет ссылки по памяти — никакого поиска в процессе генерации
// нет. Проверка четырёх опубликованных статей показала: из 38 ссылок 5 указывали
// на несуществующий DOI, а 8 — на реальный DOI СОВЕРШЕННО ДРУГОЙ работы
// (заявлено «ИИ в диагностике риносинусита», по факту «половые различия при
// аутоиммунных заболеваниях внутреннего уха»). Вторая категория опаснее: читатель
// нажимает ссылку, попадает на настоящую статью и не видит подлога.
//
// Проверка детерминированная и бесплатная: Crossref — официальный реестр DOI,
// отвечает 404 на несуществующий и отдаёт настоящее название для существующего.
// Никаких обращений к модели.
//
// ЧЕГО ЭТА ПРОВЕРКА НЕ ДЕЛАЕТ. Она подтверждает, что работа существует и названа
// правильно. Она НЕ подтверждает, что работа говорит то, что ей приписали в
// тексте статьи. Это принципиально разные вещи, и вторую машиной не закрыть.

const CROSSREF = "https://api.crossref.org/works";
const UA = "docpats-citation-check/1.0 (mailto:info@docpats.com)";
const TIMEOUT_MS = 15000;

// Насколько название в ссылке должно совпасть с настоящим. 0.5 выбрано по
// реальным данным: сокращённые названия («Septoplasty» против «Septoplasty:
// basic and advanced techniques») проходят, а подмена работы — нет.
const TITLE_MATCH = 0.5;

// Ответы реестра кэшируются: одна и та же работа встречается в разных статьях,
// а существование DOI со временем не меняется. Размер ограничен — иначе в
// долгоживущем процессе это медленная утечка.
const CACHE_LIMIT = 5000;
const cache = new Map();

function remember(doi, value) {
  if (cache.size >= CACHE_LIMIT) {
    // Выбрасываем самую старую запись: точность от этого не страдает, будет
    // просто лишний запрос к реестру.
    cache.delete(cache.keys().next().value);
  }
  cache.set(doi, value);
}

/** Сбрасывает кэш. Нужен тестам: иначе прошлые ответы подменяют новые. */
export function clearCitationCache() {
  cache.clear();
}

/** Доля значимых слов заявленного названия, встретившихся в настоящем. */
export function titleSimilarity(claimed, real) {
  const words = (s) =>
    new Set(
      String(s || "")
        .toLowerCase()
        .replace(/[^a-zа-яё0-9\s]/gi, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const a = words(claimed);
  const b = words(real);
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / a.size;
}

/**
 * Разбирает список литературы на отдельные ссылки.
 *
 * Записи идут вида «[1] Авторы. Название. Журнал. Год; Том(Номер): Стр. DOI»
 * и разделены номером в квадратных скобках — по нему и режем, потому что
 * переводы строк в этом поле не гарантированы.
 */
// Строки, которые эта же проверка дописала в прошлый раз. Их надо снять ПЕРЕД
// разбором: пометка о подмене содержит настоящее название работы, и при
// повторном прогоне оно оказывалось внутри текста ссылки — сравнение находило
// там свои же слова и объявляло подделку достоверной. Ошибка тихая и
// самоподтверждающаяся, поэтому чистим всегда.
// Ищем пометку ГДЕ УГОДНО в строке, а не только в начале: уведомление об
// удалённом источнике стоит после номера («[2] ⛔ Источник удалён…»), и привязка
// к началу строки его не снимала — повторный прогон принимал уведомление за
// текст ссылки и дописывал поверх второе предупреждение.
const OWN_NOTES = /(⚠️ не подтверждено|⛔ Источник удалён)[^\n]*/g;

export function stripOwnNotes(text) {
  return String(text || "").replace(OWN_NOTES, "");
}

export function parseReferences(text) {
  const raw = stripOwnNotes(text);
  if (!raw.trim()) return [];

  // split с группой возвращает [хвост до первого номера, номер, тело, номер,
  // тело, ...]. Отбрасываем только первый элемент: filter(Boolean) здесь
  // выбрасывал бы ПУСТЫЕ тела и сбивал пары «номер → текст» — а пустое тело
  // как раз и означает уже обработанную запись.
  const parts = raw.split(/\s*\[(\d+)\]\s*/).slice(1);
  const refs = [];

  for (let i = 0; i < parts.length - 1; i += 2) {
    const number = Number(parts[i]);
    const body = String(parts[i + 1] ?? "").trim();

    // Пустое тело означает, что запись уже обработана прошлым прогоном:
    // описание несуществующей работы было заменено уведомлением, а само
    // уведомление снято выше. Помечаем и идём дальше — иначе повторный запуск
    // объявит её «ссылкой без DOI» и допишет второе предупреждение поверх
    // первого.
    if (!body) {
      refs.push({ number, raw: "", doi: null, claimedTitle: "", alreadyRemoved: true });
      continue;
    }

    const doiMatch = body.match(/10\.\d{4,9}\/[-._;()/:a-zA-Z0-9]+/);
    const doi = doiMatch ? doiMatch[0].replace(/[.,;)]+$/, "") : null;

    refs.push({ number, raw: body, doi, claimedTitle: extractTitle(body) });
  }

  return refs;
}

/**
 * Название работы внутри записи.
 *
 * Разбиваем по точкам и берём самый длинный кусок: авторы записаны инициалами
 * и дают короткие обрывки, журнал и выходные данные тоже короткие, а название —
 * самая длинная часть. Способ грубый, но на реальных записях устойчивый, а
 * ошибка здесь не страшна: она приведёт к отказу в подтверждении, а не к тому,
 * что выдуманная ссылка пройдёт.
 */
function extractTitle(body) {
  const withoutDoi = body.replace(/https?:\/\/\S+/g, "").replace(/10\.\d{4,9}\/\S+/g, "");
  const segments = withoutDoi
    .split(/\.\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3);

  if (segments.length === 0) return "";
  return segments.reduce((a, b) => (b.length > a.length ? b : a), segments[0]);
}

async function crossrefByDoi(doi) {
  if (cache.has(doi)) return cache.get(doi);

  const res = await fetch(`${CROSSREF}/${encodeURIComponent(doi)}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const value = res.ok ? (await res.json()).message?.title?.[0] || "" : null;
  remember(doi, value);
  return value;
}

/**
 * Существует ли DOI ВООБЩЕ — по системе Handle, на которой держатся все DOI.
 *
 * Нужна потому, что Crossref регистрирует научные статьи, но не всё: книги,
 * наборы данных и часть региональных журналов сидят в DataCite, mEDRA и других
 * реестрах. Без этой проверки настоящая работа из другого реестра выглядела бы
 * несуществующей и была бы УДАЛЕНА — то есть проверка на выдумки сама породила
 * бы потерю достоверного источника.
 *
 * @returns {Promise<boolean|null>} null — проверить не удалось
 */
async function doiExistsAnywhere(doi) {
  const key = `handle:${doi}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const res = await fetch(
      `https://doi.org/api/handles/${encodeURIComponent(doi)}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const data = await res.json();
    // responseCode: 1 — найден, 100 — такого идентификатора нет.
    const exists = data?.responseCode === 1;
    remember(key, exists);
    return exists;
  } catch {
    return null;
  }
}

/**
 * Проверяет одну ссылку.
 *
 * @returns {Promise<{status: string, realTitle?: string, similarity?: number}>}
 *   ok        — работа существует и названа верно
 *   not-found — такого DOI нет НИ В ОДНОМ реестре: работа выдумана
 *   unverifiable-registry — DOI существует, но не в реестре научных статей
 *   mismatch  — DOI существует, но это другая работа
 *   no-doi    — DOI не указан, подтвердить нечем
 *   unchecked — реестр недоступен; удалять по такой причине нельзя
 */
export async function verifyReference(ref) {
  if (!ref.doi) return { status: "no-doi" };

  try {
    const realTitle = await crossrefByDoi(ref.doi);

    if (realTitle === null) {
      // Crossref не знает эту работу. Прежде чем объявлять её выдуманной,
      // спрашиваем систему Handle: она отвечает за ВСЕ DOI, независимо от
      // реестра. Если идентификатор там есть — работа настоящая, просто не
      // научная статья (книга, набор данных), и удалять её нельзя.
      const exists = await doiExistsAnywhere(ref.doi);
      if (exists === true) return { status: "unverifiable-registry" };
      if (exists === null) return { status: "unchecked" };
      return { status: "not-found" };
    }

    // Ищем слова НАСТОЯЩЕГО названия во ВСЁМ тексте ссылки, а не сравниваем с
    // выделенным заголовком. Первая версия вырезала заголовок эвристикой «самый
    // длинный кусок между точками» — и на записях с восемью авторами самым
    // длинным оказывался список авторов. Сравнение шло с ним, давало 0%, и
    // совершенно достоверные ссылки помечались как подмена. Здесь разбирать
    // запись не нужно вовсе: если работа процитирована честно, слова её
    // названия в записи есть.
    const similarity = titleSimilarity(realTitle, ref.raw);
    return similarity >= TITLE_MATCH
      ? { status: "ok", realTitle, similarity }
      : { status: "mismatch", realTitle, similarity };
  } catch (err) {
    // Сеть или реестр недоступны. Отдельный статус НАМЕРЕННО: вычищать список
    // из-за сетевого сбоя значило бы терять достоверные ссылки на ровном месте.
    return { status: "unchecked", error: err.message };
  }
}

// Что делать с записью, зависит от того, ФАКТ это или СУЖДЕНИЕ.
//
// «Такого DOI нет в реестре» — факт: Crossref отвечает 404, эвристики здесь нет
// вовсе. Такая запись не должна выглядеть источником: она им не является, и
// оставлять её со сноской значило бы показывать читателю выдумку в оформлении
// научной ссылки. Библиографическое описание заменяется прямым уведомлением, но
// НОМЕР сохраняется — в тексте статьи стоят ссылки вида [5], и удаление строки
// целиком оставило бы указание в никуда.
//
// «DOI ведёт на другую работу» — суждение: оно опирается на сравнение названий,
// а сравнение уже однажды ошибалось (принимало список авторов за заголовок).
// Здесь запись остаётся, но с предупреждением: цена лишней сноски у хорошего
// источника несопоставима с ценой удаления настоящего.
const REPLACEMENT = "⛔ Источник удалён: указанного DOI нет в реестре Crossref, работа не существует.";

const MARK = {
  mismatch: "⚠️ не подтверждено: DOI ведёт на другую работу — «{real}»",
  "no-doi": "⚠️ не подтверждено: DOI не указан, проверить нечем",
  "unverifiable-registry":
    "ⓘ идентификатор существует, но работы нет в реестре научных статей — сверьте вручную",
};

/**
 * Проверяет список и ПОМЕЧАЕТ непроверенные записи, не удаляя их.
 *
 * Почему помечаем, а не вырезаем: проверка сравнивает название работы в реестре
 * с текстом ссылки и может ошибиться на нестандартном оформлении. Удаление по
 * ошибочному признаку необратимо и уносит достоверный источник, а пометка в
 * худшем случае — лишнее предупреждение у хорошей ссылки. Цена ошибки
 * несопоставима, поэтому выбран мягкий путь.
 *
 * Непроверенные из-за недоступности реестра не помечаются вовсе: реестр лежит,
 * ссылка не виновата.
 *
 * @returns {Promise<{text: string, ok: number, flagged: Array, unchecked: number}>}
 */
export async function verifyAndAnnotate(text) {
  const refs = parseReferences(text);
  if (refs.length === 0) {
    return { text: String(text || ""), ok: 0, flagged: [], unchecked: 0 };
  }

  const lines = [];
  const flagged = [];
  let ok = 0;
  let unchecked = 0;

  let replaced = 0;

  for (const ref of refs) {
    // Запись, убранная прошлым прогоном: восстанавливаем уведомление как есть.
    // Так повторный запуск ничего не меняет — свойство, без которого скрипт
    // нельзя запускать по расписанию.
    if (ref.alreadyRemoved) {
      replaced++;
      lines.push(`[${ref.number}] ${REPLACEMENT}`);
      continue;
    }

    const verdict = await verifyReference(ref);
    const line = `[${ref.number}] ${ref.raw.trim()}`;

    if (verdict.status === "ok") {
      ok++;
      lines.push(line);
      continue;
    }
    if (verdict.status === "unchecked") {
      unchecked++;
      lines.push(line);
      continue;
    }

    if (verdict.status === "not-found") {
      // Библиографического описания больше нет — вместо него уведомление.
      // Показывать выдуманную работу в оформлении настоящей ссылки нельзя,
      // даже со сноской: читатель считывает форму раньше, чем примечание.
      replaced++;
      lines.push(`[${ref.number}] ${REPLACEMENT}`);
      flagged.push({
        number: ref.number,
        status: verdict.status,
        doi: ref.doi,
        claimedTitle: ref.claimedTitle,
        realTitle: null,
        action: "replaced",
      });
      continue;
    }

    const note = MARK[verdict.status].replace(
      "{real}",
      String(verdict.realTitle || "").slice(0, 120),
    );
    lines.push(`${line}\n    ${note}`);

    flagged.push({
      number: ref.number,
      status: verdict.status,
      doi: ref.doi,
      claimedTitle: ref.claimedTitle,
      realTitle: verdict.realTitle || null,
      action: "flagged",
    });
  }

  return { text: lines.join("\n"), ok, flagged, unchecked, replaced };
}

export default {
  parseReferences,
  verifyReference,
  verifyAndAnnotate,
  titleSimilarity,
  clearCitationCache,
};
