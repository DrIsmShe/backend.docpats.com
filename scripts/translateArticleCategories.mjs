// scripts/translateArticleCategories.mjs
//
// Догон переводов для рубрик врачебных статей.
//
// ЗАЧЕМ. Поле с переводами у рубрик появилось задним числом: те, что заведены
// раньше, знают только своё исходное название. Новые переводятся сами при
// создании, старым нужен один проход.
//
// БЕЗОПАСНО ПОВТОРЯТЬ. Уже заполненные языки не трогаются: скрипт запрашивает
// только недостающие. Прогнать его дважды не стоит ничего, кроме одного
// запроса к базе.
//
// Запуск (на сервере, где есть ключ модели):
//   node scripts/translateArticleCategories.mjs
//   node scripts/translateArticleCategories.mjs --dry   только показать

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const толькоПоказать = process.argv.includes("--dry");

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

const { default: Category } = await import(
  "../common/models/Articles/articlesCategories.js"
);
const { перевестиНазваниеРубрики } = await import(
  "../common/services/categoryTitle.service.js"
);

const ЯЗЫКИ = ["ru", "en", "az", "tr", "ar"];

const рубрики = await Category.find({}).lean();
console.log(`рубрик всего: ${рубрики.length}`);

let переведено = 0;
let пропущено = 0;

for (const рубрика of рубрики) {
  const текущее = рубрика.title || {};
  const исходное = String(текущее.ru || рубрика.name || "").trim();
  if (!исходное) {
    console.log(`—  ${рубрика._id}: нет названия, пропускаем`);
    continue;
  }

  const нехватает = ЯЗЫКИ.filter((л) => !String(текущее[л] || "").trim());
  if (!нехватает.length) {
    пропущено += 1;
    continue;
  }

  console.log(`→  «${исходное}»: нет ${нехватает.join(", ")}`);
  if (толькоПоказать) continue;

  const title = await перевестиНазваниеРубрики({ ...текущее, ru: исходное });
  await Category.updateOne({ _id: рубрика._id }, { $set: { title } });

  console.log(
    `ok «${исходное}» → ${ЯЗЫКИ.filter((л) => title[л]).map((л) => `${л}: ${title[л]}`).join(" · ")}`,
  );
  переведено += 1;
}

console.log(
  `\nитог: переведено ${переведено}, уже были переводы у ${пропущено}` +
    (толькоПоказать ? " (ничего не записано — режим --dry)" : ""),
);

await mongoose.disconnect();
