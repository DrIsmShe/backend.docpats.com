// scripts/cleanup-plaintext-messages.js
//
// ВНИМАНИЕ: Запускай ТОЛЬКО ПОСЛЕ того как:
//   1. Миграционный скрипт encrypt-existing-messages.js успешно прошёл
//   2. Прошло хотя бы 1-2 дня с того момента
//   3. Ты подтвердил что чат в проде работает корректно
//   4. Сделан свежий бэкап БД
//
// Что делает: удаляет поле `text` (plain) у всех сообщений где есть
// `textEncrypted`. После этого в БД останется только зашифрованная версия.
//
// БЕЗОПАСНОСТЬ:
//   - НЕ трогает сообщения без textEncrypted (legacy/empty)
//   - НЕ удаляет ничего кроме поля text
//   - Идемпотентный
//
// Запуск:
//   node scripts/cleanup-plaintext-messages.js --dry-run   # посчитать
//   node scripts/cleanup-plaintext-messages.js --yes-i-am-sure   # выполнить

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry-run");
const CONFIRMED = process.argv.includes("--yes-i-am-sure");

async function main() {
  console.log(
    `\n🧹 Cleanup plaintext messages — ${DRY_RUN ? "DRY RUN" : CONFIRMED ? "LIVE" : "REQUIRES --yes-i-am-sure"}\n`,
  );

  if (!DRY_RUN && !CONFIRMED) {
    console.log(
      "⚠️  This will permanently delete plaintext `text` field from all encrypted messages.",
    );
    console.log("   Run with --dry-run first to see what will happen.");
    console.log("   Run with --yes-i-am-sure to actually execute.\n");
    process.exit(1);
  }

  const mongoUri =
    process.env.MONGO_URL || process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URL / MONGO_URI / MONGODB_URI not set in env");
  }

  await mongoose.connect(mongoUri);
  console.log("✓ MongoDB connected\n");

  const collection = mongoose.connection.db.collection("messages");

  // Кандидаты на cleanup: есть textEncrypted И всё ещё есть plain text
  const filter = {
    textEncrypted: { $exists: true, $ne: null },
    text: { $exists: true, $ne: null },
  };

  const total = await collection.countDocuments(filter);
  console.log(`📊 Messages with both text AND textEncrypted: ${total}`);

  if (total === 0) {
    console.log("✅ Nothing to clean up.\n");
    await mongoose.disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log(
      `\n🔍 DRY RUN — would unset \`text\` field on ${total} messages.\n`,
    );

    // Покажем sample
    const sample = await collection.findOne(filter, {
      projection: { _id: 1, text: 1, textEncrypted: 1 },
    });
    if (sample) {
      console.log(`   Sample document (will be cleaned):`);
      console.log(`     _id: ${sample._id}`);
      console.log(
        `     text (will be removed): "${sample.text?.slice(0, 50)}..."`,
      );
      console.log(
        `     textEncrypted (will stay): "${sample.textEncrypted?.slice(0, 50)}..."\n`,
      );
    }

    await mongoose.disconnect();
    return;
  }

  console.log("\n🚨 STARTING CLEANUP — this is irreversible without backup!\n");

  const startTime = Date.now();
  const result = await collection.updateMany(filter, { $unset: { text: "" } });

  console.log(
    `✅ Cleanup done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
  );
  console.log(`   Modified: ${result.modifiedCount} messages\n`);

  // Verify
  const remaining = await collection.countDocuments(filter);
  if (remaining === 0) {
    console.log(
      "✅ Verification passed: no encrypted messages have plain text anymore.\n",
    );
  } else {
    console.log(
      `⚠️  ${remaining} messages still have plain text. Investigate.\n`,
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("\n❌ Cleanup failed:", err);
  process.exit(1);
});
