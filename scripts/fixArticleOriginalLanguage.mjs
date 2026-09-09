// scripts/fixArticleOriginalLanguage.mjs
//
// Привести метку языка оригинала в соответствие с текстом статьи.
//
// ЗАЧЕМ. Поле originalLanguage проставляется при создании и при импорте, и
// оно врёт: две статьи, написанные по-русски, помечены английскими. Из-за
// метки догоняющий перевод заказывал «перевод русского на русский» —
// оплаченный вызов модели, который ничего не даёт, а страница на английском
// показывала русский текст со словами «оригинал уже en, переводить нечего».
//
// ЧТО СЧИТАЕТСЯ ИСТИНОЙ. Текст. Метка — намерение автора или импортёра;
// текст — то, что читатель видит. Правим метку только там, где определение
// по тексту уверенно расходится с ней.
//
// Запуск:
//   node scripts/fixArticleOriginalLanguage.mjs --dry   только показать
//   node scripts/fixArticleOriginalLanguage.mjs         исправить

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const толькоПоказать = process.argv.includes("--dry");

await mongoose.connect(process.env.MONGO_URL || process.env.MONGO_URI, {
  dbName: process.env.MONGODB_DB,
});

const { default: Article } = await import(
  "../common/models/Articles/articles.js"
);
const { default: ArticleScine } = await import(
  "../common/models/Articles/articles-scince.js"
);
/* Определение языка — та же проверка, что в лентах статей (по первым
   пятистам знакам). Общего модуля для неё в проекте нет: она живёт
   копией в двух контроллерах, и третья копия здесь честнее, чем
   импорт из контроллера ради одной функции. */
const detectArticleLanguage = (titleText, contentText) => {
  const образец = `${titleText || ""} ${contentText || ""}`.slice(0, 500);
  if (/[а-яА-ЯёЁ]/.test(образец)) return "ru";
  if (/[؀-ۿ]/.test(образец)) return "ar";
  if (/[əƏ]/.test(образец)) return "az";
  if (/[çşğüöÇŞĞÜÖıİ]/.test(образец)) return "tr";
  return "en";
};

const снятьРазметку = (html) =>
  String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const МОДЕЛИ = [
  { model: Article, тип: "Article" },
  { model: ArticleScine, тип: "ArticleScine" },
];

let исправлено = 0;
let проверено = 0;

for (const { model, тип } of МОДЕЛИ) {
  const статьи = await model
    .find({}, { title: 1, content: 1, originalLanguage: 1 })
    .lean();

  for (const с of статьи) {
    проверено += 1;
    const поТексту = detectArticleLanguage(
      снятьРазметку(с.title),
      снятьРазметку(с.content),
    );
    if (!поТексту || поТексту === с.originalLanguage) continue;

    console.log(
      `${тип} ${String(с._id).slice(-6)}: метка «${с.originalLanguage || "—"}» → «${поТексту}» · ${снятьРазметку(с.title).slice(0, 50)}`,
    );

    if (!толькоПоказать) {
      await model.updateOne(
        { _id: с._id },
        { $set: { originalLanguage: поТексту } },
      );
    }
    исправлено += 1;
  }
}

console.log(
  `\nитог: проверено ${проверено}, расхождений ${исправлено}` +
    (толькоПоказать ? " (ничего не записано — режим --dry)" : " — исправлено"),
);

await mongoose.disconnect();
