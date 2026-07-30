// server/modules/guide/corpus.js
//
// Корпус документации для агента-гида.
//
// ГДЕ ЖИВУТ ТЕКСТЫ И ПОЧЕМУ НЕ ЗДЕСЬ. Разделы лежат статикой в клиентском
// репозитории (client/public/docs/<раздел>/<язык>.md): их правит человек,
// они проходят ревью вместе с кодом клиента и по тем же файлам строятся
// публичные страницы. Копия на сервере была бы вторым источником правды, и
// разошлась бы она молча — агент начал бы рассказывать про функции, которых
// на сайте уже нет.
//
// Поэтому сервер забирает их по HTTP и держит в памяти. Это допустимо именно
// здесь: файлы статические, лежат на CDN, меняются с выкладкой клиента, а не
// в рантайме, и ничего приватного в них нет.

import logger from "../../common/logger.js";
import { DEFAULT_LANG, SUPPORTED_LANGS } from "../../common/utils/requestLang.js";

// Откуда забирать. В разработке клиент обычно на localhost:3000.
const BASE_URL = (
  process.env.DOCS_BASE_URL ||
  process.env.CLIENT_URL ||
  "https://docpats.com"
).replace(/\/$/, "");

// Корпус меняется с выкладкой клиента, то есть редко. Час — компромисс между
// «не ходить в сеть на каждый вопрос» и «увидеть правку в тот же день».
const TTL_MS = Number(process.env.GUIDE_CORPUS_TTL_MS ?? 60 * 60 * 1000);

// Предохранитель: корпус целиком уезжает в каждый запрос к модели, и его
// размер — это прямые деньги. Если он вырастет до неприличного, лучше
// узнать об этом из лога, чем из счёта.
const MAX_CHARS = Number(process.env.GUIDE_CORPUS_MAX_CHARS ?? 200_000);

// Кэш на язык: ключ — код языка, значение — { text, sections, at }.
const cache = new Map();

async function fetchText(url) {
  const res = await fetch(url, { headers: { accept: "text/plain,*/*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const body = await res.text();
  // Раздача клиента отвечает index.html со статусом 200 на несуществующий
  // путь, поэтому res.ok здесь ничего не доказывает.
  if (body.trimStart().startsWith("<")) throw new Error(`not a document: ${url}`);
  return body;
}

/** Отпечаток источника, который дописывает scripts/translateDocs.js. */
const STAMP = /<!--\s*translated-from-ru:[\s\S]*?-->/g;

/**
 * Собирает корпус на нужном языке.
 *
 * Раздел без перевода берётся на русском, а не пропускается: неполный ответ
 * на своём языке хуже полного на чужом — врач хотя бы прочитает.
 */
async function buildCorpus(lang) {
  const manifest = JSON.parse(await fetchText(`${BASE_URL}/docs/index.json`));
  const sections = [];

  for (const section of manifest.sections ?? []) {
    const available = section.languages?.[lang];
    const useLang = available && available.status !== "missing" ? lang : DEFAULT_LANG;

    let text;
    try {
      text = await fetchText(`${BASE_URL}/docs/${section.name}/${useLang}.md`);
    } catch (err) {
      // Один недоступный раздел не должен лишать агента остальных.
      logger?.warn?.({ err, section: section.name, lang }, "guide: раздел не загрузился");
      continue;
    }

    sections.push({
      name: section.name,
      title: section.title,
      lang: useLang,
      text: text.replace(STAMP, "").trim(),
    });
  }

  if (!sections.length) throw new Error("корпус пуст");

  // Разделы склеиваются с явными границами: агент обязан ссылаться на раздел,
  // а для этого он должен видеть, где один кончается и начинается другой.
  const text = sections
    .map(
      (s) =>
        `<<<РАЗДЕЛ ${s.name}>>>\nАдрес на сайте: /docs/${s.name}\nЗаголовок: ${s.title}\n\n${s.text}\n<<<КОНЕЦ РАЗДЕЛА ${s.name}>>>`,
    )
    .join("\n\n");

  if (text.length > MAX_CHARS) {
    logger?.warn?.(
      { chars: text.length, max: MAX_CHARS, lang },
      "guide: корпус больше предела — он уезжает в каждый запрос к модели",
    );
  }

  return { text, sections: sections.map((s) => ({ name: s.name, title: s.title, lang: s.lang })) };
}

/**
 * Корпус на языке пользователя. Держит результат в памяти на TTL.
 *
 * При ошибке загрузки отдаёт последнюю удачную версию, даже просроченную:
 * упавшая раздача статики не повод оставить агента без знаний. Если не было
 * ни одной удачной — бросает, и вызывающий отвечает пользователю честно.
 */
export async function getCorpus(lang = DEFAULT_LANG) {
  const key = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  try {
    const built = await buildCorpus(key);
    const entry = { ...built, at: Date.now() };
    cache.set(key, entry);
    return entry;
  } catch (err) {
    if (hit) {
      logger?.warn?.({ err, lang: key }, "guide: корпус не обновился, отдаём прежний");
      return hit;
    }
    throw err;
  }
}

/** Для тестов и для ручного сброса после выкладки текстов. */
export function resetCorpusCache() {
  cache.clear();
}

export const CORPUS_BASE_URL = BASE_URL;
