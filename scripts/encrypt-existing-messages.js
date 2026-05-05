// scripts/encrypt-existing-messages.js
//
// Одноразовая миграция: проходит по всем сообщениям где есть plain `text`
// но нет `textEncrypted`, шифрует и сохраняет.
//
// БЕЗОПАСНОСТЬ:
//   - Идемпотентный: повторный запуск пропускает уже зашифрованные записи
//   - Не удаляет plain `text` — это делает отдельный cleanup-скрипт
//     (запускается только после того, как ты убедишься, что всё работает)
//   - Батчевый: обрабатывает по 100 записей за раз, не ест память
//   - При ошибке на одной записи — продолжает с остальными
//
// Запуск:
//   node scripts/encrypt-existing-messages.js
//
// Dry-run (только посчитать сколько обновится, ничего не менять):
//   node scripts/encrypt-existing-messages.js --dry-run

import mongoose from "mongoose";
import dotenv from "dotenv";
import { encrypt } from "../modules/simulation/services/encryption.service.js";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 100;

async function main() {
  console.log(
    `\n🔐 Encrypt existing messages — ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`,
  );

  const mongoUri =
    process.env.MONGO_URL || process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URL / MONGO_URI / MONGODB_URI not set in env");
  }

  // Проверка ключа ДО подключения к БД, чтобы не висеть зря
  if (!process.env.SURGERY_ENCRYPTION_KEY) {
    throw new Error("SURGERY_ENCRYPTION_KEY not set in env");
  }
  const keyBuf = Buffer.from(process.env.SURGERY_ENCRYPTION_KEY, "hex");
  if (keyBuf.length !== 32) {
    throw new Error(
      `SURGERY_ENCRYPTION_KEY must be 32 bytes (64 hex chars); got ${keyBuf.length}`,
    );
  }
  console.log("✓ Encryption key OK");

  await mongoose.connect(mongoUri);
  console.log("✓ MongoDB connected\n");

  const db = mongoose.connection.db;
  const collection = db.collection("messages");

  // 1. Считаем сколько кандидатов
  const filter = {
    text: { $exists: true, $ne: null, $ne: "" },
    $or: [{ textEncrypted: { $exists: false } }, { textEncrypted: null }],
  };

  const totalToEncrypt = await collection.countDocuments(filter);
  const totalAlreadyEncrypted = await collection.countDocuments({
    textEncrypted: { $exists: true, $ne: null },
  });
  const totalEmpty = await collection.countDocuments({
    $and: [
      { $or: [{ text: null }, { text: "" }, { text: { $exists: false } }] },
      { $or: [{ textEncrypted: null }, { textEncrypted: { $exists: false } }] },
    ],
  });

  console.log(`📊 Stats:`);
  console.log(`   Already encrypted:  ${totalAlreadyEncrypted}`);
  console.log(`   To encrypt now:     ${totalToEncrypt}`);
  console.log(`   Empty text (skip):  ${totalEmpty}\n`);

  if (totalToEncrypt === 0) {
    console.log(
      "✅ Nothing to do. All messages with text already encrypted.\n",
    );
    await mongoose.disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log(`🔍 DRY RUN — would encrypt ${totalToEncrypt} messages.\n`);
    await mongoose.disconnect();
    return;
  }

  // 2. Прогон батчами
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const failedIds = [];
  const startTime = Date.now();

  const cursor = collection.find(filter, {
    projection: { _id: 1, text: 1 },
    batchSize: BATCH_SIZE,
  });

  while (await cursor.hasNext()) {
    const batch = [];
    for (let i = 0; i < BATCH_SIZE && (await cursor.hasNext()); i++) {
      batch.push(await cursor.next());
    }

    // Шифруем + готовим bulk update
    const ops = [];
    for (const doc of batch) {
      try {
        const encrypted = encrypt(doc.text);
        if (!encrypted) continue; // пустой text после trim — пропускаем

        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { textEncrypted: encrypted } },
          },
        });
      } catch (err) {
        failed++;
        failedIds.push(doc._id.toString());
        console.error(`  ❌ ${doc._id}: ${err.message}`);
      }
    }

    if (ops.length) {
      try {
        const result = await collection.bulkWrite(ops, { ordered: false });
        succeeded += result.modifiedCount;
      } catch (err) {
        console.error(`  ❌ Batch write failed: ${err.message}`);
        failed += ops.length;
      }
    }

    processed += batch.length;
    const pct = ((processed / totalToEncrypt) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(
      `\r  Progress: ${processed}/${totalToEncrypt} (${pct}%) — ${succeeded} ok, ${failed} failed — ${elapsed}s`,
    );
  }

  console.log("\n");
  console.log(`✅ Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`   Succeeded:  ${succeeded}`);
  console.log(`   Failed:     ${failed}`);
  if (failedIds.length) {
    console.log(
      `   Failed IDs: ${failedIds.slice(0, 10).join(", ")}${failedIds.length > 10 ? "..." : ""}`,
    );
  }

  // 3. Финальная проверка
  const stillUnencrypted = await collection.countDocuments(filter);
  console.log(`\n📋 Verification:`);
  console.log(`   Still unencrypted: ${stillUnencrypted}`);
  if (stillUnencrypted === 0) {
    console.log(`   ✅ All messages with text are now encrypted.\n`);
  } else {
    console.log(
      `   ⚠️  ${stillUnencrypted} messages still unencrypted. Check failed IDs above.\n`,
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("\n❌ Migration failed:", err);
  process.exit(1);
});
