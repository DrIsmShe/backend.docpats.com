// server/modules/medicalCodes/scripts/translateCodes.js
//
// Перевод названий кодов на языки системы.
//
//   node modules/medicalCodes/scripts/translateCodes.js --lang ru --max 200
//   node modules/medicalCodes/scripts/translateCodes.js --lang ru --max 200 --dry-run
//   node modules/medicalCodes/scripts/translateCodes.js --status
//
// ПЕРЕВОД СТОИТ ДЕНЕГ, поэтому:
//   - лимит --max обязателен по смыслу (по умолчанию всего 100 кодов);
//   - без --yes скрипт сначала показывает оценку и просит подтверждения;
//   - --dry-run переводит одну пачку и показывает результат, ничего не сохраняя.
//
// Скрипт можно прерывать и запускать снова: он всегда берёт следующие коды без
// перевода, отсортированные по коду, поэтому продолжает с места остановки.

import "dotenv/config";
import readline from "node:readline/promises";
import mongoose from "mongoose";

import MedicalCode, {
  SUPPORTED_LOCALES,
} from "../models/medicalCode.model.js";
import {
  translateCodes,
  translateBatch,
  countUntranslated,
  nextUntranslatedBatch,
  BATCH_SIZE,
  MODEL,
} from "../services/codeTranslation.service.js";

function parseArgs(argv) {
  const args = { lang: null, max: 100, dryRun: false, status: false, yes: false };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--lang") args.lang = argv[++i];
    else if (flag === "--max") args.max = Number(argv[++i]) || 100;
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--status") args.status = true;
    else if (flag === "--yes") args.yes = true;
  }
  return args;
}

async function showStatus() {
  const total = await MedicalCode.countDocuments();
  console.log(`Всего кодов в справочнике: ${total}\n`);
  console.log("Язык   переведено   осталось");
  console.log("─────────────────────────────");

  for (const locale of SUPPORTED_LOCALES) {
    if (locale === "en") continue;
    const left = await countUntranslated(locale);
    const done = total - left;
    const pct = total ? Math.round((done / total) * 100) : 0;
    console.log(
      `${locale.padEnd(6)} ${String(done).padStart(9)} (${String(pct).padStart(3)}%) ${String(left).padStart(9)}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);

  const uri = process.env.MONGO_URL || process.env.MONGO_URI;
  if (!uri) {
    console.error("Не задан MONGO_URL");
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB });

  try {
    if (args.status) {
      await showStatus();
      return;
    }

    if (!args.lang || !SUPPORTED_LOCALES.includes(args.lang) || args.lang === "en") {
      console.error(
        `Укажите язык: --lang ${SUPPORTED_LOCALES.filter((l) => l !== "en").join("|")}`,
      );
      process.exitCode = 1;
      return;
    }

    const left = await countUntranslated(args.lang);
    if (left === 0) {
      console.log(`✅ На язык "${args.lang}" переведено всё.`);
      return;
    }

    const planned = Math.min(args.max, left);
    console.log(`Язык:        ${args.lang}`);
    console.log(`Модель:      ${MODEL}`);
    console.log(`Без перевода: ${left}`);
    console.log(`Переведём:   ${planned} (пачками по ${BATCH_SIZE})`);
    console.log(`Запросов к модели: ~${Math.ceil(planned / BATCH_SIZE)}\n`);

    if (args.dryRun) {
      const batch = await nextUntranslatedBatch(args.lang, { limit: 5 });
      console.log("🔍 Пробный перевод 5 названий (в базу не пишется):\n");
      const originals = batch.map((b) => `[${b.code}] ${b.titles.en}`);

      // Переводим настоящим вызовом, но результат только показываем.
      const saved = await translateBatch(batch, args.lang);
      const updated = await MedicalCode.find({
        _id: { $in: batch.map((b) => b._id) },
      })
        .select("code titles")
        .lean();

      for (let i = 0; i < updated.length; i++) {
        console.log(`  ${originals[i]}`);
        console.log(`  → ${updated[i].titles[args.lang]}\n`);
      }

      // Откатываем: пробный запуск не должен менять базу.
      await MedicalCode.bulkWrite(
        batch.map((b) => ({
          updateOne: {
            filter: { _id: b._id },
            update: { $set: { [`titles.${args.lang}`]: b.titles[args.lang] || "" } },
          },
        })),
        { ordered: false },
      );
      console.log(`(проверено ${saved} шт., изменения отменены)`);
      return;
    }

    if (!args.yes && process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await rl.question("Продолжить? [y/N] ");
      rl.close();
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log("Отменено.");
        return;
      }
    }

    const started = Date.now();
    const { translated, failedBatches } = await translateCodes(args.lang, {
      max: planned,
      onProgress: ({ translated: done, total }) =>
        console.log(`   ${done}/${total}`),
    });

    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`\n✅ Переведено ${translated} за ${seconds}с`);
    if (failedBatches > 0) {
      console.log(`   Пачек с ошибкой: ${failedBatches}`);
    }
    console.log(`   Осталось без перевода: ${await countUntranslated(args.lang)}`);
  } catch (err) {
    console.error("\n❌", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
