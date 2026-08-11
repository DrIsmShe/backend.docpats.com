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
  getUsage,
} from "../services/codeTranslation.service.js";

// Цены за миллион токенов. Нужны только для того, чтобы в конце запуска было
// видно порядок суммы: решение «переводить ли оставшиеся языки» иначе
// принимается вслепую. Прайс меняется — цифра справочная, не бухгалтерская.
const PRICE_PER_MTOK = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

function reportUsage(translated) {
  const usage = getUsage();
  const { requests, inputTokens, outputTokens } = usage;
  if (requests === 0) return;

  console.log(
    `   Запросов: ${requests}, токенов: ${inputTokens.toLocaleString("ru")} на вход, ` +
      `${outputTokens.toLocaleString("ru")} на выход`,
  );

  const cost = costOf(usage);
  if (cost === null) return;

  const perCode = translated > 0 ? cost / translated : 0;
  console.log(
    `   Примерная стоимость: $${cost.toFixed(2)}` +
      (perCode > 0
        ? ` (~$${(perCode * 1000).toFixed(2)} за 1000 кодов)`
        : ""),
  );
}

// Потолок трат на ОДИН запуск, в долларах. Нужен потому, что ключ Anthropic в
// проекте один на всё: этим же балансом живут надиктовка, диагностика,
// ИИ-консультация, ночная генерация кейсов радиологии и движок новостей.
// Массовый перевод идёт часами без присмотра — без потолка он способен
// доесть баланс ночью, и обнаружится это утром отказом у врача, а не здесь.
// Ноль или --budget 0 снимает ограничение.
const DEFAULT_BUDGET_USD = Number(process.env.MEDICAL_CODES_TRANSLATION_BUDGET ?? 60);

function parseArgs(argv) {
  const args = {
    lang: null,
    max: 100,
    dryRun: false,
    status: false,
    yes: false,
    budget: DEFAULT_BUDGET_USD,
  };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--lang") args.lang = argv[++i];
    else if (flag === "--max") args.max = Number(argv[++i]) || 100;
    else if (flag === "--budget") args.budget = Math.max(0, Number(argv[++i]) || 0);
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--status") args.status = true;
    else if (flag === "--yes") args.yes = true;
  }
  return args;
}

/** Во сколько обошёлся расход. null — цена этой модели неизвестна. */
function costOf({ inputTokens, outputTokens }) {
  const price = PRICE_PER_MTOK[MODEL];
  if (!price) return null;
  return (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
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
    console.log(`Запросов к модели: ~${Math.ceil(planned / BATCH_SIZE)}`);
    console.log(
      args.budget > 0
        ? `Потолок трат: $${args.budget} за запуск (снять: --budget 0)\n`
        : `Потолок трат: снят — прогон остановится только по кодам или ошибкам\n`,
    );

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
    const { translated, failedBatches, stoppedBy } = await translateCodes(
      args.lang,
      {
        max: planned,
        onProgress: ({ translated: done, total }) =>
          console.log(`   ${done}/${total}`),
        // Потолок проверяется перед каждой пачкой. Считаем по уже
        // израсходованным токенам, а не по прикидке: цена названия заметно
        // разная у языков (арабский и азербайджанский дороже русского).
        shouldStop: args.budget > 0
          ? ({ usage }) => {
              const spent = costOf(usage);
              return spent !== null && spent >= args.budget ? "budget" : false;
            }
          : null,
      },
    );

    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`\n✅ Переведено ${translated} за ${seconds}с`);
    if (stoppedBy === "budget") {
      console.log(
        `   ⛔ Остановлено потолком трат ($${args.budget}). Баланс общий с ` +
          `надиктовкой, диагностикой и ночными кейсами — остаток им и оставлен.`,
      );
      console.log(`   Продолжить: тот же запуск, при желании --budget больше.`);
    }
    if (failedBatches > 0) {
      console.log(`   Пачек с ошибкой: ${failedBatches}`);
    }
    reportUsage(translated);
    console.log(`   Осталось без перевода: ${await countUntranslated(args.lang)}`);
  } catch (err) {
    console.error("\n❌", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
