// server/modules/medicalCodes/scripts/importIcd10cm.js
//
// Загружает справочник МКБ-10-CM в коллекцию medical_codes.
//
//   node modules/medicalCodes/scripts/importIcd10cm.js
//   node modules/medicalCodes/scripts/importIcd10cm.js --dry-run   (не писать в базу)
//   node modules/medicalCodes/scripts/importIcd10cm.js --limit 500 (для проверки)
//
// Источник — публичный API NLM (clinicaltables.nlm.nih.gov), тот самый,
// который сейчас дёргается из браузера врача. Смысл переноса: справочник
// перестаёт зависеть от связи с США, отвечает за миллисекунды и становится
// местом, куда можно положить переводы.
//
// Почему обход по префиксам, а не сплошная пагинация: у NLM нет endpoint'а с
// полным дампом, а `offset` жёстко обрывается на ~7400 (дальше HTTP 400).
// Поэтому справочник берётся по частям — запросом кодов, начинающихся с "A",
// "B", … Если часть сама не влезает в лимит (на "S" приходится 31 052 кода —
// это травмы), префикс углубляется: "S0", "S1", … и так далее, пока каждая
// выборка не станет меньше предела.
//
// Скрипт ИДЕМПОТЕНТЕН: повторный запуск обновит записи, а не удвоит их
// (bulkWrite с upsert по паре system+code). Прервали на середине — просто
// запустите снова.

import "dotenv/config";
import mongoose from "mongoose";
import MedicalCode, {
  CODE_SYSTEMS,
  buildSearchText,
  normalizeCode,
} from "../models/medicalCode.model.js";

const NLM_URL = "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search";
const PAGE_SIZE = 500; // максимум, который отдаёт NLM за один запрос
const BATCH_SIZE = 1000; // сколько документов пишем в базу за раз
const RETRY_DELAY_MS = 3000;
const MAX_RETRIES = 3;

// Практический предел offset у NLM: на 7400 уже HTTP 400. Берём с запасом —
// если выборка по префиксу больше, префикс углубляется.
const OFFSET_LIMIT = 7000;

// Из чего складываются коды МКБ-10: буква, дальше цифры и буквы.
const FIRST_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const NEXT_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = { dryRun: false, limit: Infinity };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    if (argv[i] === "--limit") args.limit = Number(argv[i + 1]) || Infinity;
  }
  return args;
}

/**
 * Одна страница выборки по префиксу кода. NLM отдаёт массив вида
 *   [total, [коды...], null, [[код, название], ...]]
 * — без имён полей, поэтому разбираем по позициям.
 *
 * sf=code (а не code,name) принципиально: иначе префикс "A" совпал бы ещё и с
 * любым названием, где есть буква A, и выборка перестала бы быть разбиением.
 */
async function fetchPage(prefix, offset) {
  const url =
    `${NLM_URL}?sf=code&df=code,name&terms=${encodeURIComponent(prefix)}` +
    `&count=${PAGE_SIZE}&offset=${offset}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const total = Number(data?.[0]) || 0;
      const rows = Array.isArray(data?.[3]) ? data[3] : [];
      return { total, rows };
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.warn(
        `[icd10cm] "${prefix}" offset=${offset}, попытка ${attempt}/${MAX_RETRIES}: ${err.message}`,
      );
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

/**
 * Сколько кодов начинается с этого префикса. Один дешёвый запрос: нужен только
 * счётчик, поэтому count=1.
 */
async function countFor(prefix) {
  const { total } = await fetchPage(prefix, 0);
  return total;
}

/**
 * Родительская рубрика: "J35.01" → "J35". У кодов без точки родителя нет.
 *
 * Нужна, чтобы показать врачу группу и чтобы позже строить дерево. Полноценную
 * иерархию МКБ (главы, блоки) NLM не отдаёт — она появится вместе с данными
 * ВОЗ на следующем этапе.
 */
function parentOf(code) {
  const dot = code.indexOf(".");
  return dot > 0 ? code.slice(0, dot) : "";
}

function toDocument(code, title) {
  const trimmedCode = String(code).trim();
  return {
    system: CODE_SYSTEMS.ICD10CM,
    code: trimmedCode,
    codeNormalized: normalizeCode(trimmedCode),
    titles: { en: String(title).trim(), ru: "", az: "", tr: "", ar: "" },
    parentCode: parentOf(trimmedCode),
    // NLM отдаёт только конечные (billable) коды МКБ-10-CM — рубрик-заголовков
    // в этой выдаче нет. Когда добавится версия ВОЗ, там флаг будет считаться
    // иначе, поэтому он в модели, а не выводится на лету.
    isBillable: true,
    version: new Date().getFullYear().toString(),
  };
}

async function writeBatch(docs, dryRun) {
  if (dryRun || docs.length === 0) return 0;

  const operations = docs.map((doc) => ({
    updateOne: {
      filter: { system: doc.system, code: doc.code },
      update: {
        $set: { ...doc, searchText: buildSearchText(doc) },
      },
      upsert: true,
    },
  }));

  const result = await MedicalCode.bulkWrite(operations, { ordered: false });
  return (result.upsertedCount || 0) + (result.modifiedCount || 0);
}

async function main() {
  const { dryRun, limit } = parseArgs(process.argv);

  const uri = process.env.MONGO_URL || process.env.MONGO_URI;
  if (!uri) {
    console.error("Не задан MONGO_URL — импортировать некуда.");
    process.exit(1);
  }

  if (!dryRun) {
    await mongoose.connect(uri, { dbName: process.env.MONGODB_DB });
    console.log("✅ Mongo подключена");
  } else {
    console.log("🔍 Пробный запуск: в базу ничего не пишется");
  }

  const started = Date.now();
  let fetched = 0;
  let written = 0;
  let batch = [];
  const seenCodes = new Set();

  // Общее число кодов — только для процента в логе.
  const grandTotal = await countFor("");
  console.log(`📚 В справочнике МКБ-10-CM: ${grandTotal} кодов`);

  const flush = async (force = false) => {
    if (batch.length >= BATCH_SIZE || (force && batch.length > 0)) {
      written += await writeBatch(batch, dryRun);
      batch = [];
      const pct = grandTotal ? Math.round((fetched / grandTotal) * 100) : 0;
      console.log(`   ${fetched}/${grandTotal} (${pct}%)`);
    }
  };

  /**
   * Выкачивает все коды с этим префиксом. Если их больше, чем позволяет
   * листать offset, дробит префикс дальше и уходит вглубь.
   */
  async function harvest(prefix) {
    if (fetched >= limit) return;

    const total = await countFor(prefix);
    if (total === 0) return;

    if (total > OFFSET_LIMIT) {
      console.log(`   ↳ "${prefix}": ${total} кодов — дроблю префикс`);
      for (const ch of NEXT_CHARS) {
        await harvest(prefix + ch);
        if (fetched >= limit) return;
      }
      return;
    }

    for (let offset = 0; offset < total; offset += PAGE_SIZE) {
      const page = await fetchPage(prefix, offset);
      if (page.rows.length === 0) break;

      for (const [code, title] of page.rows) {
        if (!code || !title) continue;
        // Дробление префиксов не пересекается, но подстраховка дешевле, чем
        // разбор дублей в базе.
        if (seenCodes.has(code)) continue;
        seenCodes.add(code);

        batch.push(toDocument(code, title));
        fetched++;
      }

      await flush();
      if (fetched >= limit) return;
    }
  }

  try {
    for (const ch of FIRST_CHARS) {
      await harvest(ch);
      if (fetched >= limit) break;
    }

    await flush(true);

    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(
      `\n✅ Готово за ${seconds}с: получено ${fetched}, записано/обновлено ${written}`,
    );

    if (!dryRun) {
      const inDb = await MedicalCode.countDocuments({
        system: CODE_SYSTEMS.ICD10CM,
      });
      console.log(`   Всего в коллекции medical_codes: ${inDb}`);
    }
  } catch (err) {
    console.error("\n❌ Импорт прерван:", err.message);
    console.error("   Запустите скрипт снова — записанное не потеряется.");
    process.exitCode = 1;
  } finally {
    if (!dryRun) await mongoose.disconnect();
  }
}

main();
