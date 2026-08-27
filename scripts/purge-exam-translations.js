#!/usr/bin/env node
/**
 * server/scripts/purge-exam-translations.js
 *
 * Снимает переводы с теста: он снова становится одноязычным.
 *
 * ЗАЧЕМ. Раскладка витрины поменялась: язык курса — обычная рубрика каталога
 * («Азербайджанский», «Türkçe», …), и в каждую кладётся свой тест, написанный
 * сразу на нужном языке. Тесты, переведённые до этого решения, остаются
 * пятиязычными: вопросы-переводы лежат в банке, значит ExamProgram.languages
 * содержит все пять, и тест находится фильтром на каждом языке — даже лёжа в
 * рубрике одного.
 *
 * ЧТО СНИМАЕТСЯ: вопросы-переводы (ExamItem с заполненным translationOf),
 * переводы названия и описания теста; languages и primaryLang пересобираются
 * по оставшемуся банку.
 *
 * ЧТО НЕ ТРОГАЕТСЯ: оригиналы вопросов. Перевод всегда был ОТДЕЛЬНЫМ
 * документом, поэтому оригиналов останется ровно столько же, сколько было.
 *
 * Использование (из папки server/):
 *   node scripts/purge-exam-translations.js --title=Юнг            # сухой прогон
 *   node scripts/purge-exam-translations.js --id=<id>              # сухой прогон
 *   node scripts/purge-exam-translations.js --id=<id> --apply
 *   node scripts/purge-exam-translations.js --id=<id> --apply --attempts=keep
 *   node scripts/purge-exam-translations.js --id=<id> --apply --attempts=delete
 *
 * Тест ищется в ЛЮБОМ статусе: снятый с публикации или архивный чистится так
 * же, как опубликованный.
 *
 * --attempts обязателен, только если на переводах кто-то уже проходил тест.
 * Решение не подставляется за человека:
 *   keep   — попытки остаются. Балл посчитан и хранится, но разбор покажет
 *            меньше вопросов, чем было. История цела, выглядит неполной.
 *   delete — попытки удаляются. Разбор не врёт, но из статистики врача
 *            пропадает то, что он действительно проходил.
 *
 * Идемпотентен: повторный прогон на вычищенном тесте не находит работы.
 */

import "dotenv/config";
import mongoose from "mongoose";

import ExamProgram from "../modules/education/education-catalog/models/examProgram.model.js";
import {
  inspectProgramTranslations,
  purgeProgramTranslations,
} from "../modules/education/education-translation/purgeTranslations.service.js";

const MONGO_URL =
  process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URL) throw new Error("MONGO_URL required");

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const APPLY = has("apply");
const ID = arg("id");
const CODE = arg("code");
const TITLE = arg("title");
const ATTEMPTS = arg("attempts");

/** Ищем в любом статусе: снятый с публикации тест чистится так же. */
async function findProgram() {
  if (ID) return ExamProgram.findById(ID).select("_id title status").lean();
  if (CODE) {
    return ExamProgram.findOne({ code: String(CODE).toLowerCase() })
      .select("_id title status")
      .lean();
  }
  if (TITLE) {
    const safe = String(TITLE).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = await ExamProgram.find({ title: new RegExp(safe, "i") })
      .select("_id title status")
      .lean();
    if (found.length > 1) {
      console.log(`Под «${TITLE}» подходит несколько тестов — уточните --id:`);
      for (const p of found) {
        console.log(`   ${p._id}  [${p.status}]  ${p.title}`);
      }
      return null;
    }
    return found[0] ?? null;
  }
  return null;
}

const run = async () => {
  if (!ID && !CODE && !TITLE) {
    console.log("Укажите тест: --id=<id>, --code=<code> или --title=<часть названия>");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URL, {
    dbName: process.env.MONGODB_DB || "DOCPATS_NEW",
  });

  const program = await findProgram();
  if (!program) {
    console.log("Тест не найден.");
    await mongoose.disconnect();
    process.exit(1);
  }

  const report = await inspectProgramTranslations(program._id);

  console.log(`Тест: ${report.program.title}`);
  console.log(`   id ${report.program._id} · статус ${report.program.status}`);
  console.log(`   languages: [${report.program.languages.join(", ")}]`);
  console.log(
    `   primaryLang: ${report.program.primaryLang ?? "не задан"} · переводы названия: ${
      report.program.titleTranslations.join(", ") || "нет"
    }`,
  );
  console.log(`   вопросов-оригиналов: ${report.originalCount}`);
  console.log(`   вопросов-переводов:  ${report.translationCount}`);
  for (const [lang, n] of Object.entries(report.translationsByLang)) {
    console.log(`      ${lang}: ${n}`);
  }
  console.log(`   попыток, пройденных на переводах: ${report.affectedAttempts}`);

  if (report.translationCount === 0) {
    console.log("\nПереводов нет — снимать нечего.");
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    console.log(
      "\n— сухой прогон, ничего не удалено. Повторите с --apply." +
        (report.affectedAttempts > 0
          ? "\n  На переводах уже проходили тест — добавьте --attempts=keep либо" +
            "\n  --attempts=delete (см. шапку скрипта)."
          : ""),
    );
    await mongoose.disconnect();
    return;
  }

  try {
    const result = await purgeProgramTranslations(program._id, {
      attempts: ATTEMPTS,
    });
    console.log(`\n✅ Снято вопросов-переводов: ${result.removedItems}`);
    if (result.deletedAttempts) {
      console.log(`   удалено попыток: ${result.deletedAttempts}`);
    }
    console.log(
      `   стало: languages [${result.after.languages.join(", ")}] · ` +
        `primaryLang ${result.after.primaryLang} · ` +
        `опубликованных вопросов ${result.after.publishedItemCount}`,
    );
  } catch (err) {
    console.log(`\n❌ ${err?.message ?? err}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("❌", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
