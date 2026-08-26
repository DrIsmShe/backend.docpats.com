// __tests__/setup.js
//
// Global setup for all test files.
// Uses MongoMemoryReplSet (single-node replica set) so we can run
// transactions in tests (session.withTransaction).

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { beforeAll, afterAll, afterEach } from "vitest";
import "dotenv/config";
let mongoServer;

// Set test env defaults
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = "test_encryption_key_padded_to_32_chars";
}

// КЛЮЧИ МОДЕЛЕЙ ГАСИМ. dotenv выше подтягивает боевой .env, а в нём живые
// ANTHROPIC_API_KEY и OPENAI_API_KEY. Без этого забытый мок не падает, а
// молча уходит в платный API: тест остаётся ЗЕЛЁНЫМ (модель ведь ответила),
// прогон растягивается с секунд до минут, и счёт растёт. Именно так и
// случилось, когда в агента-доводчика добавили разбор замечаний и забыли
// замокать судью — caseAgent.test.js шёл 292 с вместо 10 и звонил в Anthropic
// на каждом прогоне.
//
// Пустой ключ ломает такой тест сразу и понятно: isConfigured() возвращает
// false, вызов падает с «ИИ не настроен». Это ровно тот сигнал, который
// нужен — забыли мок, а не «тесты медленные».
//
// Осознанный обход — ALLOW_REAL_AI_IN_TESTS=1 — на случай, когда кто-то
// намеренно проверяет живую интеграцию.
if (!process.env.ALLOW_REAL_AI_IN_TESTS) {
  process.env.ANTHROPIC_API_KEY = "";
  process.env.ANTHROPIC_AUTH_TOKEN = "";
  process.env.OPENAI_API_KEY = "";
}

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    // Своё время на запуск mongod вместо умолчания в 10 секунд.
    //
    // Каждый файл поднимает свой экземпляр, и на загруженной машине запуск
    // иногда не укладывается в 10 с — падает случайный файл, каждый раз новый,
    // и каждый проходит при отдельном прогоне. Это ложное падение: оно ничего
    // не говорит о коде, но роняет прогон и CI, а красный прогон, которому не
    // верят, хуже отсутствующего.
    //
    // Ожидание не замедляет обычный запуск: таймаут срабатывает только когда
    // старт действительно не удался. hook-timeout ниже (60 с) оставляет запас.
    instanceOpts: [{ launchTimeout: 45000 }],
  });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { dbName: "test" });
}, 90000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
}, 30000);

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});
