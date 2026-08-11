// modules/medicalCodes/scripts/createSearchIndex.js
//
// Создание индекса Atlas Search для справочника кодов.
//
// Долго считалось, что индекс заводится только руками в интерфейсе Atlas.
// Это уже не так: начиная с MongoDB 7.0 драйвер умеет команду
// createSearchIndexes, и на Atlas она доступна обычному подключению. На
// не-Atlas (локальный Mongo, mongodb-memory-server) команда не поддерживается —
// скрипт скажет об этом прямо, а не упадёт непонятной ошибкой.
//
// Скрипт идемпотентен: если индекс уже есть, он обновляется под текущую
// конфигурацию (updateSearchIndex), а не создаётся вторым.
//
// Индекс строится АСИНХРОННО. После создания он какое-то время в статусе
// PENDING/BUILDING, и поиск в это время всё ещё идёт обычным Mongo — модуль
// проверяет статус и не переключается на недостроенный индекс.
//
//   node modules/medicalCodes/scripts/createSearchIndex.js
//   MONGODB_DB=DOCPATS_NEW node modules/medicalCodes/scripts/createSearchIndex.js
//   node modules/medicalCodes/scripts/createSearchIndex.js --wait   # ждать сборки

import "dotenv/config";
import mongoose from "mongoose";

import MedicalCode, { SUPPORTED_LOCALES } from "../models/medicalCode.model.js";

const INDEX_NAME = "medical_codes_search";

// Конфигурация повторяет README модуля. dynamic: false — индексируем ровно то,
// по чему ищем: лишние поля раздували бы индекс без пользы.
const DEFINITION = {
  mappings: {
    dynamic: false,
    fields: {
      codeNormalized: [
        { type: "string" },
        { type: "autocomplete", minGrams: 2, maxGrams: 8 },
      ],
      titles: {
        type: "document",
        fields: Object.fromEntries(
          SUPPORTED_LOCALES.map((loc) => [loc, { type: "string" }]),
        ),
      },
      system: { type: "string" },
    },
  },
};

const POLL_MS = 5000;
const WAIT_LIMIT_MS = 15 * 60 * 1000;

async function listIndexes(collection) {
  try {
    return await collection.listSearchIndexes().toArray();
  } catch (err) {
    // Не Atlas — команды поиска нет вовсе.
    if (/not supported|Unrecognized|command not found|CommandNotFound/i.test(err.message)) {
      return null;
    }
    throw err;
  }
}

async function main() {
  const wait = process.argv.includes("--wait");

  const uri = process.env.MONGO_URL || process.env.MONGO_URI;
  if (!uri) {
    console.error("Не задан MONGO_URL");
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB });
  const collection = MedicalCode.collection;
  // База выводится явно: скрипт запускается и по локальной, и по боевой базе
  // одного и того же кластера, и перепутать их — самая дорогая ошибка здесь.
  console.log(
    `✅ Mongo подключена — база "${mongoose.connection.name}", коллекция "${collection.collectionName}"`,
  );

  try {
    const existing = await listIndexes(collection);

    if (existing === null) {
      console.error(
        "❌ Этот Mongo не поддерживает Atlas Search. Индекс нужен только на Atlas;\n" +
          "   локально и в тестах модуль работает обычным поиском.",
      );
      process.exitCode = 1;
      return;
    }

    const already = existing.find((idx) => idx.name === INDEX_NAME);

    if (already) {
      console.log(`ℹ️  Индекс "${INDEX_NAME}" уже есть (статус ${already.status}) — обновляю конфигурацию`);
      await collection.updateSearchIndex(INDEX_NAME, DEFINITION);
    } else {
      await collection.createSearchIndex({
        name: INDEX_NAME,
        definition: DEFINITION,
      });
      console.log(`✅ Индекс "${INDEX_NAME}" создан`);
    }

    // Сборка идёт в фоне на стороне Atlas. Без ожидания скрипт завершится
    // раньше, чем индексом можно пользоваться, — это нормально, но при деплое
    // удобнее дождаться и увидеть READY своими глазами.
    const started = Date.now();
    for (;;) {
      const [idx] = (await listIndexes(collection)).filter(
        (i) => i.name === INDEX_NAME,
      );
      const status = idx?.status ?? "UNKNOWN";
      console.log(`   статус: ${status}${idx?.queryable ? " (готов к запросам)" : ""}`);

      if (status === "FAILED") {
        console.error("❌ Atlas не смог построить индекс — проверьте конфигурацию в интерфейсе");
        process.exitCode = 1;
        return;
      }
      if (idx?.queryable) {
        console.log("✅ Индекс готов. Поиск переключится на Atlas после перезапуска процесса.");
        return;
      }
      if (!wait) {
        console.log(
          "ℹ️  Индекс строится в фоне. Запустите с --wait, чтобы дождаться,\n" +
            "   или просто вернитесь позже: до готовности поиск идёт обычным Mongo.",
        );
        return;
      }
      if (Date.now() - started > WAIT_LIMIT_MS) {
        console.warn("⚠️  Ждём дольше 15 минут — проверьте состояние в интерфейсе Atlas");
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  } catch (err) {
    console.error("❌ Не удалось создать индекс:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
