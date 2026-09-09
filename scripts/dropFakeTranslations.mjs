// scripts/dropFakeTranslations.mjs
//
// Убрать «переводы», в которых лежит оригинал.
//
// ЗАЧЕМ. Прежний переводчик при ошибке возвращал исходный текст, и он
// сохранялся как готовый перевод. Такая запись хуже открытого сбоя:
// очередь считает работу сделанной, лента показывает «переведённую»
// карточку на языке оригинала, а заметить это может только человек,
// читающий на этом языке. Одна такая нашлась на арабском.
//
// ЧТО СЧИТАЕТСЯ ПОДДЕЛКОЙ. Заголовок перевода совпадает с заголовком
// оригинала. Содержимое может законно совпасть на формулах и латинских
// названиях, заголовок — практически никогда.
//
// БЕЗОПАСНО ПОВТОРЯТЬ: удалённые переводы закажутся заново обычным
// догоняющим переводом.
//
// Запуск:
//   node scripts/dropFakeTranslations.mjs --dry   только показать
//   node scripts/dropFakeTranslations.mjs         удалить

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const толькоПоказать = process.argv.includes("--dry");

await mongoose.connect(process.env.MONGO_URL || process.env.MONGO_URI, {
  dbName: process.env.MONGODB_DB,
});

const db = mongoose.connection.db;
const переводы = db.collection("contenttranslations");

const КОЛЛЕКЦИИ = {
  Article: "articles",
  ArticleScine: "articlescines",
};

const нормализовать = (т) =>
  String(т || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const все = await переводы.find({}).toArray();
console.log("переводов всего:", все.length);

let подделок = 0;

for (const п of все) {
  const имя = КОЛЛЕКЦИИ[п.entityType];
  if (!имя) continue;

  const оригинал = await db
    .collection(имя)
    .findOne({ _id: п.entityId }, { projection: { title: 1 } });
  if (!оригинал) continue;

  if (нормализовать(п.title) !== нормализовать(оригинал.title)) continue;

  подделок += 1;
  console.log(
    `подделка: ${п.entityType} ${String(п.entityId).slice(-6)} → ${п.language}: «${String(п.title).slice(0, 60)}»`,
  );

  if (!толькоПоказать) await переводы.deleteOne({ _id: п._id });
}

console.log(
  `\nитог: ${подделок} записей${толькоПоказать ? " (ничего не удалено — режим --dry)" : " удалено"}`,
);

await mongoose.disconnect();
