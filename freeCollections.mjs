// Освободить место в кластере: удалить ПУСТЫЕ коллекции.
//
// ЗАЧЕМ. Общий кластер Atlas ограничен 500 коллекциями НА ВСЕ БАЗЫ СРАЗУ.
// Когда предел выбран, любая первая запись в новую коллекцию падает с
// «cannot create a new collection -- already using 500 collections of 500»,
// и в боевой базе перестают заводиться новые сущности: разделы витрины,
// подписки, жалобы. Лимит принадлежит кластеру, а не базе, — поэтому
// база разработки, живущая рядом, отнимает место у боевой.
//
// ЧТО УДАЛЯЕТСЯ. Только коллекции с нулём документов. Пустая коллекция —
// это след от модели, которой ни разу не пользовались; mongoose создаст
// её заново при первой записи вместе с индексами. Данные не теряются,
// потому что данных в ней нет.
//
// ЧТО НЕ УДАЛЯЕТСЯ НИКОГДА. Журнал HIPAA и сессии — даже пустыми. Журнал
// append-only и создаётся с особыми настройками (TTL, запрет изменений);
// пересоздавать его походя нельзя. Сессии пустые ровно до первого входа.
//
// БЕЗ КЛЮЧА НИЧЕГО НЕ ДЕЛАЕТ. Запуск без --apply только показывает список:
// решение удалять принимает человек, а не аргумент по умолчанию.
//
// ЗАПУСК:
//   node freeCollections.mjs                       — показать, что уйдёт
//   node freeCollections.mjs --apply               — удалить в своей базе
//   node freeCollections.mjs --db=ИМЯ --apply      — в названной базе
//   node freeCollections.mjs --all                 — обойти все базы кластера

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

/* Коллекции, которые не трогаем ни при каких условиях. Совпадение по
   точному имени: «похожие» имена — не повод удалять чужое. */
const НЕПРИКОСНОВЕННЫЕ = new Set([
  "hipaa_audit_logs",
  "sessions",
  "anthropometry_audit_logs",
  "doctorverificationauditlogs",
]);

const аргументы = process.argv.slice(2);
const применить = аргументы.includes("--apply");
const всеБазы = аргументы.includes("--all");
const указанная = (аргументы.find((а) => а.startsWith("--db=")) || "").slice(5);

async function разобрать(client, имяБазы) {
  const db = client.db(имяБазы);
  const коллекции = await db.listCollections().toArray();

  const пустые = [];
  for (const c of коллекции) {
    if (НЕПРИКОСНОВЕННЫЕ.has(c.name)) continue;
    // estimatedDocumentCount читает метаданные, а не перебирает документы:
    // на трёхстах коллекциях разница между секундой и минутами.
    if ((await db.collection(c.name).estimatedDocumentCount()) === 0) {
      пустые.push(c.name);
    }
  }

  console.log(
    `\n${имяБазы}: коллекций ${коллекции.length}, пустых ${пустые.length}`,
  );
  if (!пустые.length) return 0;

  if (!применить) {
    console.log("  (показ без удаления; чтобы удалить, добавьте --apply)");
    console.log("  " + пустые.slice(0, 12).join(", ") + (пустые.length > 12 ? ", …" : ""));
    return 0;
  }

  let удалено = 0;
  for (const имя of пустые) {
    try {
      await db.collection(имя).drop();
      удалено += 1;
    } catch (err) {
      // Коллекция могла исчезнуть между проверкой и удалением — это не
      // ошибка, а ровно тот исход, которого мы добивались.
      if (!/ns not found/i.test(err.message)) {
        console.warn(`  не удалось удалить ${имя}: ${err.message}`);
      }
    }
  }
  console.log(`  удалено: ${удалено}`);
  return удалено;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URL, {
    dbName: process.env.MONGODB_DB || undefined,
  });
  const client = mongoose.connection.getClient();

  let базы;
  if (всеБазы) {
    const { databases } = await client.db().admin().listDatabases();
    базы = databases
      .map((d) => d.name)
      .filter((имя) => !["admin", "local", "config"].includes(имя));
  } else {
    базы = [указанная || mongoose.connection.name];
  }

  let итого = 0;
  for (const имя of базы) итого += await разобрать(client, имя);

  // Сколько места осталось в кластере — единственное число, ради которого
  // всё и затевалось.
  const { databases } = await client.db().admin().listDatabases();
  let занято = 0;
  for (const d of databases) {
    if (["admin", "local", "config"].includes(d.name)) continue;
    занято += (await client.db(d.name).listCollections().toArray()).length;
  }

  console.log(`\nвсего освобождено: ${итого}`);
  console.log(`занято на кластере: ${занято} из 500`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("ОШИБКА:", err.message);
  process.exit(1);
});
