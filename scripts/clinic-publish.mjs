// server/scripts/clinic-publish.mjs
//
// Одноразовая утилита для этапа A (Clinic-as-Brand).
// Грузит .env сам (в отличие от inline node -e), корректно работает с $set.
//
// Использование (из папки server/):
//   node scripts/clinic-publish.mjs                 → список всех клиник
//   node scripts/clinic-publish.mjs <slug>          → опубликовать клинику (isPublished=true, isActive=true)
//   node scripts/clinic-publish.mjs <slug> off      → снять публикацию (isPublished=false)
//
// PowerShell: slug передавай как обычный аргумент, без кавычек если без спецсимволов.

import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL;
const DB_NAME = process.env.MONGODB_DB || "DOCPATS_NEW";

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI/MONGO_URL не найден в .env");
  process.exit(1);
}

const slug = process.argv[2]; // undefined → режим списка
const mode = process.argv[3]; // "off" → снять публикацию

async function main() {
  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
  console.log(`✅ Подключено к ${DB_NAME}\n`);

  const Clinic = (
    await import("../modules/clinic/clinic-core/models/clinic.model.js")
  ).default;

  // ─── Режим списка ───
  if (!slug) {
    const list = await Clinic.find({})
      .select("name slug isPublished isActive description logo")
      .lean();

    if (!list.length) {
      console.log("(клиник в базе нет)");
    } else {
      console.log(`Клиник: ${list.length}\n`);
      for (const c of list) {
        console.log(
          [
            `• ${c.name}`,
            `  slug:        ${c.slug}`,
            `  isPublished: ${c.isPublished === true}`,
            `  isActive:    ${c.isActive !== false}`,
            `  description: ${c.description ? `${c.description.length} симв.` : "—"}`,
            `  logo:        ${c.logo || "—"}`,
          ].join("\n"),
        );
        console.log("");
      }
    }
    await mongoose.disconnect();
    process.exit(0);
  }

  // ─── Режим публикации / снятия ───
  const publish = mode !== "off";
  const update = publish
    ? { isPublished: true, isActive: true }
    : { isPublished: false };

  const r = await Clinic.updateOne({ slug }, { $set: update });

  if (r.matchedCount === 0) {
    console.error(`❌ Клиника со slug "${slug}" не найдена`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(
    `✅ slug "${slug}" → ${publish ? "ОПУБЛИКОВАНА" : "снята с публикации"} ` +
      `(matched:${r.matchedCount}, modified:${r.modifiedCount})`,
  );

  // Покажем итоговое состояние
  const after = await Clinic.findOne({ slug })
    .select("name slug isPublished isActive")
    .lean();
  console.log(JSON.stringify(after, null, 2));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Ошибка:", e.message);
  process.exit(1);
});
