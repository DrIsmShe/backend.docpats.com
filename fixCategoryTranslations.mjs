// Перечинить названия разделов витрины, переведённые неудачно.
//
// ЗАЧЕМ. Переводчик рассчитан на статьи, и на названии из одного слова он
// возвращал что придётся: раздел «Анатомия» получил арабским текстом
// русское слово кириллицей, а турецким — несуществующее «Anatomia».
// Проверка похожести добавлена в сервис, но разделы, заведённые до неё,
// уже лежат в базе с мусором.
//
// ЧТО ДЕЛАЕТ. Убирает у каждого раздела переводы, не похожие на свой язык,
// и просит перевести заново — уже с проверкой. Русское название не
// трогает: оно написано человеком.
//
// БЕЗ КЛЮЧА ТОЛЬКО ПОКАЗЫВАЕТ. Запуск без --apply перечисляет, что
// считает мусором, и ничего не меняет.
//
// ЗАПУСК: node fixCategoryTranslations.mjs [--apply]

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const применить = process.argv.includes("--apply");

/** Та же проверка, что и в сервисе: ловит НЕПЕРЕВОД, а не плохой стиль. */
function похожеНаЯзык(текст, язык) {
  const t = String(текст || "").trim();
  if (!t) return false;
  const кириллица = /[Ѐ-ӿ]/.test(t);
  const арабица = /[؀-ۿ]/.test(t);
  if (язык === "ar") return арабица;
  if (["en", "tr", "az"].includes(язык)) return !кириллица && !арабица;
  return true;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URL, {
    dbName: process.env.MONGODB_DB || undefined,
  });
  console.log(`база: ${mongoose.connection.name}`);

  const { default: VideoCategory } = await import(
    "./modules/video/models/videoCategory.model.js"
  );
  const { перевестиНазвание } = await import(
    "./modules/video/services/videoCategory.service.js"
  );

  const разделы = await VideoCategory.find({});
  let тронуто = 0;

  for (const раздел of разделы) {
    const было = раздел.title.toObject ? раздел.title.toObject() : { ...раздел.title };
    const плохие = ["en", "az", "tr", "ar"].filter(
      (я) => было[я] && !похожеНаЯзык(было[я], я),
    );
    const пустые = ["en", "az", "tr", "ar"].filter((я) => !String(было[я] || "").trim());

    if (!плохие.length && !пустые.length) {
      console.log(`— ${было.ru}: в порядке`);
      continue;
    }

    console.log(
      `• ${было.ru}: мусор [${плохие.join(", ") || "—"}], пусто [${пустые.join(", ") || "—"}]`,
    );
    for (const я of плохие) console.log(`    ${я}: «${было[я]}»`);

    if (!применить) continue;

    // Мусор стираем ДО перевода: сервис дописывает только пустые поля.
    const очищенное = { ru: было.ru };
    for (const я of ["en", "az", "tr", "ar"]) {
      if (было[я] && !плохие.includes(я)) очищенное[я] = было[я];
    }

    раздел.title = await перевестиНазвание(очищенное);
    await раздел.save();
    тронуто += 1;

    const стало = раздел.title.toObject ? раздел.title.toObject() : раздел.title;
    console.log(
      `    → ${["en", "az", "tr", "ar"].map((я) => `${я}: ${стало[я] || "—"}`).join(" · ")}`,
    );
  }

  console.log(
    применить ? `\nисправлено разделов: ${тронуто}` : "\n(показ; чтобы исправить — --apply)",
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("ОШИБКА:", err.message);
  process.exit(1);
});
