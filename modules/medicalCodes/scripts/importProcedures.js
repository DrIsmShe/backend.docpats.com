// server/modules/medicalCodes/scripts/importProcedures.js
//
// Загружает коды ВМЕШАТЕЛЬСТВ (операций и процедур) — ICD-9-CM Volume 3.
//
//   node modules/medicalCodes/scripts/importProcedures.js
//   node modules/medicalCodes/scripts/importProcedures.js --dry-run
//
// Почему ICD-9-CM Vol.3, а не ICHI: ICHI (ВОЗ) моложе и точнее, но доступен
// только через ICD API ВОЗ, который требует регистрации. Vol.3 — public domain,
// 3 882 кода, лежит в том же публичном API NLM, что и болезни. Когда появится
// доступ к ICHI, коды лягут в ту же коллекцию под своей `system` — модель это
// предусматривает, миграция не понадобится.
//
// В отличие от импорта болезней, здесь НЕ нужен обход по префиксам: кодов
// меньше четырёх тысяч, и offset до конца таблицы работает.
//
// Скрипт идемпотентен: повторный запуск обновит записи, а не удвоит их.

import "dotenv/config";
import mongoose from "mongoose";
import MedicalCode, {
  CODE_SYSTEMS,
  buildSearchText,
  normalizeCode,
} from "../models/medicalCode.model.js";

const NLM_URL = "https://clinicaltables.nlm.nih.gov/api/icd9cm_sg/v3/search";
const PAGE_SIZE = 500;
const RETRY_DELAY_MS = 3000;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  return { dryRun: argv.includes("--dry-run") };
}

/**
 * Страница таблицы процедур.
 *
 * `df` НЕ передаём намеренно: с ним код приходит без точки ("0001"), а по
 * умолчанию — в каноническом виде ("00.01"). Именно этот вид врач видит в
 * документах, и именно он должен попасть в запись операции.
 */
async function fetchPage(offset) {
  const url = `${NLM_URL}?terms=&count=${PAGE_SIZE}&offset=${offset}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      return {
        total: Number(data?.[0]) || 0,
        rows: Array.isArray(data?.[3]) ? data[3] : [],
      };
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.warn(
        `[icd9cm_sg] offset=${offset}, попытка ${attempt}/${MAX_RETRIES}: ${err.message}`,
      );
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

/**
 * Родительская рубрика: "28.4" → "28". У процедур это раздел вмешательств
 * (в примере — операции на миндалинах и аденоидах).
 */
function parentOf(code) {
  const dot = code.indexOf(".");
  return dot > 0 ? code.slice(0, dot) : "";
}

function toDocument(code, title) {
  const trimmed = String(code).trim();
  return {
    system: CODE_SYSTEMS.ICD9CM_SG,
    code: trimmed,
    codeNormalized: normalizeCode(trimmed),
    titles: { en: String(title).trim(), ru: "", az: "", tr: "", ar: "" },
    parentCode: parentOf(trimmed),
    // Двузначные коды вида "28" — это разделы, а не конкретные вмешательства:
    // ставить их в запись операции нельзя, нужен код с уточнением.
    isBillable: trimmed.includes("."),
    version: new Date().getFullYear().toString(),
  };
}

async function main() {
  const { dryRun } = parseArgs(process.argv);

  const uri = process.env.MONGO_URL || process.env.MONGO_URI;
  if (!uri) {
    console.error("Не задан MONGO_URL");
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
  let total = 0;

  try {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await fetchPage(offset);
      if (offset === 0) {
        total = page.total;
        console.log(`🔧 Кодов вмешательств (ICD-9-CM Vol.3): ${total}`);
      }
      if (page.rows.length === 0) break;

      const docs = page.rows
        .filter(([code, title]) => code && title)
        .map(([code, title]) => toDocument(code, title));
      fetched += docs.length;

      if (!dryRun && docs.length > 0) {
        const result = await MedicalCode.bulkWrite(
          docs.map((doc) => ({
            updateOne: {
              filter: { system: doc.system, code: doc.code },
              update: { $set: { ...doc, searchText: buildSearchText(doc) } },
              upsert: true,
            },
          })),
          { ordered: false },
        );
        written += (result.upsertedCount || 0) + (result.modifiedCount || 0);
      }

      console.log(`   ${fetched}/${total}`);
      if (offset + PAGE_SIZE >= total) break;
    }

    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(
      `\n✅ Готово за ${seconds}с: получено ${fetched}, записано/обновлено ${written}`,
    );

    if (!dryRun) {
      const inDb = await MedicalCode.countDocuments({
        system: CODE_SYSTEMS.ICD9CM_SG,
      });
      console.log(`   Кодов вмешательств в базе: ${inDb}`);
    }
  } catch (err) {
    console.error("\n❌ Импорт прерван:", err.message);
    console.error("   Запустите снова — записанное не потеряется.");
    process.exitCode = 1;
  } finally {
    if (!dryRun) await mongoose.disconnect();
  }
}

main();
