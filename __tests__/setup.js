// __tests__/setup.js
//
// Global setup for all test files.
// Uses MongoMemoryReplSet (single-node replica set) so we can run
// transactions in tests (session.withTransaction).

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { beforeAll, afterAll, afterEach } from "vitest";

let mongoServer;

// Set test env defaults
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = "test_encryption_key_padded_to_32_chars";
}

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { dbName: "test" });
}, 60000);

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
