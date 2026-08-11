// server/modules/medicalCodes/scripts/copyTranslations.js
//
// Переносит уже сделанные переводы названий из одной базы в другую.
//
//   node modules/medicalCodes/scripts/copyTranslations.js --from DOCPATS_NEW_LOCAL --to DOCPATS_NEW
//   node modules/medicalCodes/scripts/copyTranslations.js --from A --to B --lang ru --dry-run
//
// Зачем: перевод стоит денег и времени (~6 часов на язык). Если справочник уже
// переведён в базе разработки, платить второй раз за то же самое на проде
// незачем — коды и английские названия там идентичны, потому что оба
// справочника загружены из одного источника.
//
// Переносятся ТОЛЬКО непустые переводы и ТОЛЬКО поверх пустых: если в целевой
// базе уже есть перевод, он остаётся. Так повторный запуск безопасен, а ручные
// правки на проде не затираются машинным переводом.

import "dotenv/config";
import mongoose from "mongoose";
import { SUPPORTED_LOCALES, buildSearchText } from "../models/medicalCode.model.js";

const BATCH = 1000;

function parseArgs(argv) {
  const args = { from: null, to: null, langs: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--from") args.from = argv[++i];
    else if (argv[i] === "--to") args.to = argv[++i];
    else if (argv[i] === "--lang") args.langs = [argv[++i]];
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const langs = (args.langs || SUPPORTED_LOCALES).filter((l) => l !== "en");

  if (!args.from || !args.to) {
    console.error(
      "Укажите базы: --from DOCPATS_NEW_LOCAL --to DOCPATS_NEW",
    );
    process.exit(1);
  }
  if (args.from === args.to) {
    console.error("Источник и приёмник совпадают");
    process.exit(1);
  }

  const uri = process.env.MONGO_URL || process.env.MONGO_URI;
  await mongoose.connect(uri, { dbName: args.from });
  const client = mongoose.connection.getClient();

  const source = client.db(args.from).collection("medical_codes");
  const target = client.db(args.to).collection("medical_codes");

  console.log(`Источник: ${args.from}`);
  console.log(`Приёмник: ${args.to}`);
  console.log(`Языки:    ${langs.join(", ")}`);
  if (args.dryRun) console.log("🔍 Пробный запуск: ничего не пишется");
  console.log("");

  try {
    for (const lang of langs) {
      // Берём только те, где перевод реально есть.
      const cursor = source.find(
        { [`titles.${lang}`]: { $nin: ["", null] } },
        { projection: { system: 1, code: 1, titles: 1 } },
      );

      let scanned = 0;
      let updated = 0;
      let operations = [];

      const flush = async () => {
        if (operations.length === 0) return;
        if (!args.dryRun) {
          const result = await target.bulkWrite(operations, { ordered: false });
          updated += result.modifiedCount || 0;
        }
        operations = [];
      };

      for await (const doc of cursor) {
        scanned++;

        // Поверх пустого — не затираем то, что уже переведено или поправлено
        // руками в целевой базе.
        operations.push({
          updateOne: {
            filter: {
              system: doc.system,
              code: doc.code,
              $or: [
                { [`titles.${lang}`]: "" },
                { [`titles.${lang}`]: { $exists: false } },
              ],
            },
            update: [
              {
                $set: {
                  [`titles.${lang}`]: doc.titles[lang],
                  // searchText пересобираем из ЦЕЛЕВОГО документа плюс новый
                  // перевод: у него могут быть свои переводы на другие языки,
                  // и затирать их строкой из источника нельзя.
                  searchText: {
                    $concat: ["$searchText", " ", doc.titles[lang]],
                  },
                },
              },
            ],
          },
        });

        if (operations.length >= BATCH) {
          await flush();
          console.log(`   ${lang}: просмотрено ${scanned}, перенесено ${updated}`);
        }
      }

      await flush();
      console.log(
        `${lang}: в источнике ${scanned} переводов, перенесено ${updated}`,
      );
    }
  } catch (err) {
    console.error("\n❌", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
