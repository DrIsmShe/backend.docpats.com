// modules/admin/controllers/dumpReader.js
//
// Построчное чтение дампа при загрузке обратно в базу.
//
// ЗАЧЕМ. Первая версия загрузки читала файл целиком в строку и разбирала одним
// EJSON.parse. На основной базе это работало (дамп ~95 МБ), а на базе новостей
// нет: там 17 000 документов по 33 КБ, дамп выходит **1081 МБ**, и строка такой
// длины в V8 невозможна в принципе — предел около 512 МБ. То есть файл
// скачивался полностью, а вернуть его было нельзя. Резервная копия, которую
// нельзя восстановить, — половина копии.
//
// ПОЧЕМУ ПОСТРОЧНО МОЖНО. Формат пишется нами же (writeDump), и каждый документ
// занимает РОВНО одну строку: EJSON.stringify не переносит строки, а внутренние
// переводы строк экранируются как \n внутри JSON-строки. Значит документ никогда
// не разорвётся между строками, и файл читается потоком без сборки в памяти.
//
// Разбор намеренно не общий JSON-парсер, а маленький автомат по строкам: он
// понимает ровно тот формат, который писал writeDump, и на чужом файле честно
// отказывается, а не пытается угадать.

import fs from "node:fs";
import readline from "node:readline";
import { EJSON } from "bson";

export const FORMAT = "docpats-dump-v2";

// Строки конверта, по которым автомат ориентируется.
const RE_HEADER = /^"(format|database|exportedAt)":/;
const RE_COLLECTIONS_OPEN = /^"collections":\{/;
const RE_COLLECTION_START = /^"([^"]+)":\[$/;
const RE_STATS = /^"stats":(\{.*\}),?$/;
const RE_COMPLETED = /^"completed":true$/;

/**
 * Читает дамп построчно, отдавая документы порциями.
 *
 * @param {string} filePath
 * @param {object} handlers
 * @param {Function} handlers.onCollection  (name) => void — началась коллекция
 * @param {Function} handlers.onBatch       (name, docs) => Promise — порция документов
 * @param {number} [handlers.batchSize]
 * @returns {Promise<{stats: object, completed: boolean, counts: object}>}
 */
export async function readDump(filePath, { onCollection, onBatch, batchSize = 1000 }) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let current = null; // имя текущей коллекции
  let batch = [];
  let stats = {};
  let completed = false;
  const counts = {};

  const flush = async () => {
    if (!current || batch.length === 0) return;
    await onBatch(current, batch);
    counts[current] = (counts[current] || 0) + batch.length;
    batch = [];
  };

  for await (const raw of rl) {
    // Хвостовая запятая между элементами — часть конверта, а не документа.
    const line = raw.trim().replace(/,$/, "");
    if (!line || line === "{" || line === "}" || line === "},") continue;

    if (RE_HEADER.test(line) || RE_COLLECTIONS_OPEN.test(line)) continue;

    if (RE_COMPLETED.test(line)) {
      completed = true;
      continue;
    }

    const statsMatch = line.match(RE_STATS);
    if (statsMatch) {
      try {
        stats = JSON.parse(statsMatch[1]);
      } catch {
        stats = {};
      }
      continue;
    }

    const startMatch = line.match(RE_COLLECTION_START);
    if (startMatch) {
      await flush();
      current = startMatch[1];
      counts[current] = counts[current] || 0;
      // await обязателен: в режиме замены здесь очищается коллекция, и без
      // ожидания первая порция документов легла бы ДО очистки — и была бы
      // ею стёрта.
      await onCollection?.(current);
      continue;
    }

    if (line === "]") {
      await flush();
      current = null;
      continue;
    }

    // Пустая коллекция пишется как "name":[] одной строкой.
    const emptyMatch = line.match(/^"([^"]+)":\[\]$/);
    if (emptyMatch) {
      await flush();
      current = emptyMatch[1];
      counts[current] = 0;
      // Пустая коллекция в дампе — тоже состояние, которое надо восстановить:
      // в режиме замены это означает «здесь ничего не было».
      await onCollection?.(current);
      current = null;
      continue;
    }

    if (!current) continue; // мусор вне коллекции — пропускаем

    if (line.startsWith("{")) {
      batch.push(EJSON.parse(line, { relaxed: false }));
      if (batch.length >= batchSize) await flush();
    }
  }

  await flush();
  return { stats, completed, counts };
}

/**
 * Дешёвый проверочный проход БЕЗ записи в базу.
 *
 * Нужен потому, что при потоковой загрузке вставка идёт по ходу чтения, а
 * отметка о завершении лежит в КОНЦЕ файла: без отдельного прохода обрезанный
 * дамп успел бы записаться наполовину — ровно то, чего формат и должен не
 * допускать. Документы здесь не разбираются, только считаются, поэтому проход
 * быстрый даже на гигабайтном файле.
 *
 * @returns {Promise<{completed: boolean, counts: object, stats: object}>}
 */
export async function scanDump(filePath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let current = null;
  let completed = false;
  let stats = {};
  const counts = {};

  for await (const raw of rl) {
    const line = raw.trim().replace(/,$/, "");
    if (!line) continue;

    if (RE_COMPLETED.test(line)) {
      completed = true;
      continue;
    }

    const statsMatch = line.match(RE_STATS);
    if (statsMatch) {
      try {
        stats = JSON.parse(statsMatch[1]);
      } catch {
        stats = {};
      }
      continue;
    }

    const emptyMatch = line.match(/^"([^"]+)":\[\]$/);
    if (emptyMatch) {
      counts[emptyMatch[1]] = 0;
      current = null;
      continue;
    }

    const startMatch = line.match(RE_COLLECTION_START);
    if (startMatch) {
      current = startMatch[1];
      counts[current] = 0;
      continue;
    }

    if (line === "]") {
      current = null;
      continue;
    }

    if (current && line.startsWith("{")) counts[current] += 1;
  }

  return { completed, counts, stats };
}

/**
 * Быстрая проверка: это наш формат?
 *
 * Читает только начало файла — по нему видно, идти построчно или разбирать
 * старый дамп целиком.
 */
export async function detectFormat(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8", end: 4096 });
  let head = "";
  for await (const chunk of stream) head += chunk;
  return head.includes(`"format":"${FORMAT}"`) ? FORMAT : "legacy";
}
