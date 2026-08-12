// scripts/verifyPublishedCitations.js
//
// Сверка списков литературы в УЖЕ ОПУБЛИКОВАННЫХ статьях и пометка
// неподтверждённых ссылок.
//
// Повод: статьи генерировались моделью, которая писала литературу по памяти —
// никакого поиска в процессе не было. Замер по четырём опубликованным статьям:
// из 38 ссылок 5 указывали на несуществующий DOI, а 8 — на реальный DOI ЧУЖОЙ
// работы. Вторая категория опаснее: читатель нажимает, попадает на настоящую
// статью в настоящем журнале и не видит подлога.
//
// НИЧЕГО НЕ УДАЛЯЕТСЯ. Проверка сравнивает название работы в реестре с текстом
// ссылки и может ошибиться на нестандартном оформлении — первая версия,
// например, принимала длинный список авторов за название и браковала вполне
// достоверные источники. Удаление по ошибочному признаку необратимо и уносит
// настоящий источник; пометка в худшем случае даёт лишнее предупреждение у
// хорошей ссылки. Цена ошибки несопоставима.
//
// Скрипт трогает только поле references, добавляя строку-предупреждение под
// сомнительной записью. Текст статьи не редактируется, нумерация сохраняется:
// в теле стоят ссылки вида [3], и сдвиг превратил бы их в указания на чужие
// работы — ровно в ту ошибку, которую скрипт и должен показывать.
//
//   node scripts/verifyPublishedCitations.js                 # только показать
//   node scripts/verifyPublishedCitations.js --apply         # проставить пометки
//   MONGODB_DB=DOCPATS_NEW node scripts/verifyPublishedCitations.js --apply

import "dotenv/config";
import mongoose from "mongoose";

import {
  parseReferences,
  verifyAndAnnotate,
} from "../common/services/citationCheck.service.js";

const COLLECTIONS = ["articles", "articlescines", "usersyntheses"];

const STATUS_LABEL = {
  "not-found": "DOI не существует",
  mismatch: "DOI ведёт на другую работу",
  "no-doi": "нет DOI — подтвердить нечем",
};

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGO_URL || process.env.MONGO_URI;
  if (!uri) {
    console.error("Не задан MONGO_URL");
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB });
  const db = mongoose.connection.getClient().db(process.env.MONGODB_DB);
  console.log(`База: ${db.databaseName}`);
  console.log(apply ? "РЕЖИМ ЗАПИСИ\n" : "Пробный прогон, ничего не меняется\n");

  const totals = { articles: 0, refs: 0, kept: 0, removed: 0, unchecked: 0 };
  // Разбивка по причинам: «нет DOI» и «DOI ведёт на чужую работу» — разные по
  // тяжести случаи, и решать по ним надо тоже по-разному.
  const byReason = { "not-found": 0, mismatch: 0, "no-doi": 0 };

  for (const name of COLLECTIONS) {
    const col = db.collection(name);
    const docs = await col
      .find({ references: { $exists: true, $ne: "" } })
      .project({ title: 1, references: 1 })
      .toArray();

    for (const doc of docs) {
      const original = typeof doc.references === "string" ? doc.references : "";
      const refs = parseReferences(original);
      if (refs.length === 0) continue;

      totals.articles++;
      console.log(`\n━━ [${name}] ${String(doc.title).slice(0, 60)}`);
      console.log(`   ссылок: ${refs.length}`);

      const result = await verifyAndAnnotate(original);
      totals.refs += refs.length;
      totals.kept += result.ok;
      totals.removed += result.flagged.length;
      totals.unchecked += result.unchecked;

      for (const f of result.flagged) {
        byReason[f.status] = (byReason[f.status] || 0) + 1;
        console.log(`   ⚠ [${f.number}] ${STATUS_LABEL[f.status]}`);
        if (f.realTitle) {
          console.log(`      по этому DOI на самом деле: ${f.realTitle.slice(0, 70)}`);
        }
      }

      if (result.unchecked > 0) {
        console.log(`   ⓘ не проверено (реестр недоступен): ${result.unchecked}`);
      }
      if (result.flagged.length === 0) {
        console.log("   ✅ все ссылки подтверждены");
        continue;
      }

      // Ссылки остаются на месте, добавляется только строка-предупреждение.
      // Нумерация сохраняется: в тексте статьи стоят ссылки вида [3], и сдвиг
      // превратил бы их в указания на чужие работы.
      const rebuilt = result.text;

      console.log(
        `   → пометок: ${result.flagged.length}, подтверждено: ${result.ok}`,
      );

      if (apply) {
        await col.updateOne(
          { _id: doc._id },
          {
            $set: {
              references: rebuilt,
              citationCheck: {
                checkedAt: new Date(),
                total: refs.length,
                confirmed: result.ok,
                flagged: result.flagged,
              },
            },
          },
        );
        console.log("   💾 записано");
      }
    }
  }

  console.log("\n═══ ИТОГ");
  console.log(`статей со ссылками: ${totals.articles}`);
  console.log(`ссылок проверено:   ${totals.refs}`);
  console.log(`подтверждено:       ${totals.kept}`);
  console.log(`помечено:           ${totals.removed}`);
  console.log(`   из них DOI не существует:        ${byReason["not-found"]}`);
  console.log(`   из них DOI ведёт на чужую работу: ${byReason.mismatch}`);
  console.log(`   из них без DOI (проверить нечем): ${byReason["no-doi"]}`);
  if (totals.unchecked > 0) {
    console.log(`не проверено:       ${totals.unchecked} (оставлены)`);
  }
  if (!apply && totals.removed > 0) {
    console.log("\nЗапустите с --apply, чтобы записать изменения.");
  }

  await mongoose.disconnect();
}

main();
