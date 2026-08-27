#!/usr/bin/env node
/**
 * server/scripts/translate-exam-programs.js
 *
 * Переводит названия и описания уже созданных тестов на остальные языки.
 *
 * ЗАЧЕМ. Вопросы банка переводились давно (публикация вопроса ставит перевод
 * в очередь), а сам тест — нет. Из-за этого каталог был вынужден показывать
 * тест ровно на одном языке: врач, выбравший азербайджанский, иначе получил
 * бы карточку «Типология личности по Карлу Юнгу» с русским заголовком.
 *
 * Теперь тест переводится при публикации и при правке названия
 * (program.service → scheduleProgramTranslation), а каталог показывает его
 * везде, где у него есть вопросы. Скрипт нужен один раз — для тестов, уже
 * лежащих в базе: без него у них останется заголовок на языке оригинала.
 *
 * ЯЗЫК ОРИГИНАЛА берём из primaryLang, а если он не проставлен — по вопросам,
 * которые НЕ являются переводами (resolveProgramSourceLang). Угадывать по
 * письменности, как у рубрик, не нужно: банк знает это точно.
 *
 * Именно поэтому не languages[0]: порядок в languages задаёт EXAM_LANGUAGES с
 * "ru" первым, и азербайджанский тест с уже переведёнными вопросами объявлялся
 * бы русским — переводы поехали бы «с русского», а primaryLang записался бы
 * неверно.
 *
 * Использование (из папки server/):
 *   node scripts/translate-exam-programs.js                 # сухой прогон
 *   node scripts/translate-exam-programs.js --apply         # перевести недостающее
 *   node scripts/translate-exam-programs.js --apply --force # пересобрать все переводы
 *   node scripts/translate-exam-programs.js --apply --all   # включая черновики и архив
 *
 * По умолчанию берутся только ОПУБЛИКОВАННЫЕ тесты: черновик переименуют ещё
 * не раз, и перевод для него — деньги на ветер. Он переведётся сам при
 * публикации.
 *
 * Идемпотентен: тест с полным набором переводов пропускается, если не --force.
 */

import "dotenv/config";
import mongoose from "mongoose";

import ExamProgram from "../modules/education/education-catalog/models/examProgram.model.js";
import { translateProgramContent } from "../modules/education/education-catalog/services/programTranslator.js";
import { resolveProgramSourceLang } from "../modules/education/education-catalog/services/program.service.js";
import { EXAM_LANGUAGES } from "../modules/education/constants.js";

const MONGO_URL =
  process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URL) throw new Error("MONGO_URL required");

const has = (name) => process.argv.includes(`--${name}`);

const APPLY = has("apply");
const FORCE = has("force");
const ALL_STATUSES = has("all");

const run = async () => {
  await mongoose.connect(MONGO_URL, {
    dbName: process.env.MONGODB_DB || "DOCPATS_NEW",
  });
  console.log("✅ MongoDB подключена");

  const query = ALL_STATUSES ? {} : { status: "published" };
  const programs = await ExamProgram.find(query).sort({ title: 1 });
  console.log(
    `Тестов ${ALL_STATUSES ? "всего" : "опубликованных"}: ${programs.length}\n`,
  );

  const plan = [];
  const skipped = [];

  for (const p of programs) {
    if (!String(p.title ?? "").trim()) {
      skipped.push({ p, why: "пустое название" });
      continue;
    }
    const source = await resolveProgramSourceLang(p);
    const have = new Set((p.translations ?? []).map((t) => t.lang));
    const missing = EXAM_LANGUAGES.filter((l) => l !== source && !have.has(l));
    if (!missing.length && !FORCE) {
      skipped.push({ p, why: "переводы уже есть" });
      continue;
    }
    plan.push({
      p,
      source,
      targets: FORCE ? EXAM_LANGUAGES.filter((l) => l !== source) : missing,
    });
  }

  console.log(`К переводу: ${plan.length}`);
  for (const item of plan) {
    console.log(
      `   [${item.source}] ${item.p.title}  →  ${item.targets.join(", ")}`,
    );
  }
  console.log(`\nПропущено: ${skipped.length}`);
  for (const s of skipped) {
    console.log(`   ${s.p.title}  — ${s.why}`);
  }

  if (!APPLY) {
    console.log("\n— сухой прогон, ничего не записано. Повторите с --apply.");
    await mongoose.disconnect();
    return;
  }

  let done = 0;
  for (const item of plan) {
    try {
      const translations = await translateProgramContent({
        title: item.p.title,
        description: item.p.description ?? "",
        sourceLang: item.source,
        targetLangs: item.targets,
      });
      if (!translations.length) {
        console.log(`   ⚠ ${item.p.title}: модель ничего не вернула`);
        continue;
      }
      // Свои переводы дополняем, а не затираем: --force пересобирает всё,
      // обычный прогон только доносит недостающие языки.
      const merged = new Map(
        (FORCE ? [] : item.p.translations ?? []).map((t) => [t.lang, t]),
      );
      for (const t of translations) merged.set(t.lang, t);

      item.p.translations = [...merged.values()];
      // Заодно фиксируем язык оригинала: дальше от него считается, что
      // переводить и к чему откатываться, когда перевода нет.
      if (!item.p.primaryLang) item.p.primaryLang = item.source;
      await item.p.save();
      done += 1;
      console.log(
        `   ✅ ${item.p.title} → ` +
          translations.map((t) => `${t.lang}: ${t.title}`).join(" · "),
      );
    } catch (err) {
      console.log(`   ❌ ${item.p.title}: ${err?.message ?? err}`);
    }
  }

  console.log(`\nПереведено тестов: ${done} из ${plan.length}`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("❌", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
