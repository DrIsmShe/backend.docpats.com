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
