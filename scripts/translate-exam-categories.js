#!/usr/bin/env node
/**
 * server/scripts/translate-exam-categories.js
 *
 * Переводит названия уже созданных рубрик каталога тестов на остальные языки.
 *
 * ЗАЧЕМ. У рубрики не было языка вообще: одно поле name, набранное админом на
 * своём языке. Азербайджанский врач видел в каталоге «Психология», «Научные» и
 * «Psixoloqiya» вперемешку — причём первые две не переведены, а третья
 * оказывалась ОТДЕЛЬНОЙ категорией, заведённой руками на другом языке.
 * Выглядело как сломанный фильтр по языку, хотя сломано было одно: рубрика не
 * знала, на каком языке она написана.
 *
 * Новые рубрики переводятся сами при создании и при переименовании
 * (category.service → scheduleCategoryTranslation). Скрипт нужен один раз —
 * для тех, что уже лежат в базе.
 *
 * ЯЗЫК ОРИГИНАЛА определяем по письменности того же принципа, что и в
 * fix-exam-item-langs.js: по ПРЕОБЛАДАЮЩЕЙ письменности, а не по её наличию.
 * Латиницу без «ə» не трогаем — турецкий и английский так не различить, а
 * ошибка здесь означает перевод «с турецкого» текста, который на самом деле
 * английский. Такие рубрики оставляем админу: --lang= задаёт язык вручную.
 *
 * Использование (из папки server/):
 *   node scripts/translate-exam-categories.js              # сухой прогон
 *   node scripts/translate-exam-categories.js --apply      # перевести
 *   node scripts/translate-exam-categories.js --apply --lang=az   # считать все az
 *   node scripts/translate-exam-categories.js --apply --force     # и уже переведённые
 *
 * Идемпотентен: рубрика с полным набором переводов пропускается, если не --force.
 */

import "dotenv/config";
import mongoose from "mongoose";

import ExamCategory from "../modules/education/education-categories/models/examCategory.model.js";
import { translateCategoryContent } from "../modules/education/education-categories/services/categoryTranslator.js";
import { EXAM_LANGUAGES } from "../modules/education/constants.js";

const MONGO_URL =
  process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URL) throw new Error("MONGO_URL required");

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const APPLY = has("apply");
const FORCE = has("force");
const FORCED_LANG = arg("lang");

const DOMINANCE = 0.7;
const MIN_LETTERS = 4; // названия рубрик короткие — «Научные» это 7 букв

function detectLang(text) {
  const t = String(text ?? "");
  const cyr = (t.match(/[Ѐ-ӿ]/g) ?? []).length;
  const arab = (t.match(/[؀-ۿݐ-ݿ]/g) ?? []).length;
  const lat = (t.match(/[A-Za-zÀ-ɏəƏ]/g) ?? []).length;
  const total = cyr + arab + lat;
  if (total < MIN_LETTERS) return null;
  if (cyr / total >= DOMINANCE) return "ru";
  if (arab / total >= DOMINANCE) return "ar";
  if (lat / total >= DOMINANCE) return /[əƏ]/.test(t) ? "az" : null;
  return null;
}

const run = async () => {
  await mongoose.connect(MONGO_URL, {
    dbName: process.env.MONGODB_DB || "DOCPATS_NEW",
  });
  console.log("✅ MongoDB подключена");

  const categories = await ExamCategory.find({}).sort({ name: 1 });
  console.log(`Рубрик всего: ${categories.length}\n`);

  const plan = [];
  const skipped = [];

  for (const c of categories) {
    const have = new Set((c.translations ?? []).map((t) => t.lang));
    const source =
      FORCED_LANG && EXAM_LANGUAGES.includes(FORCED_LANG)
        ? FORCED_LANG
        : detectLang(c.name) ?? null;

    if (!source) {
      skipped.push({ c, why: "язык не определён по письменности" });
      continue;
    }
    const missing = EXAM_LANGUAGES.filter((l) => l !== source && !have.has(l));
    if (!missing.length && !FORCE) {
      skipped.push({ c, why: "переводы уже есть" });
      continue;
    }
    plan.push({ c, source, targets: FORCE ? EXAM_LANGUAGES.filter((l) => l !== source) : missing });
  }

  console.log(`К переводу: ${plan.length}`);
  for (const p of plan) {
    console.log(`   [${p.source}] ${p.c.name}  →  ${p.targets.join(", ")}`);
  }
  console.log(`\nПропущено: ${skipped.length}`);
  for (const s of skipped) {
    console.log(`   ${s.c.name}  — ${s.why}`);
  }

  if (!APPLY) {
    console.log(
      "\n— сухой прогон, ничего не записано. Повторите с --apply.\n" +
        "  Рубрики с неопределённым языком (латиница без «ə» — турецкий или\n" +
        "  английский) задайте вручную: --lang=tr либо --lang=en.",
    );
    await mongoose.disconnect();
    return;
  }

  let done = 0;
  for (const p of plan) {
    try {
      const translations = await translateCategoryContent({
        name: p.c.name,
        description: p.c.description ?? "",
        sourceLang: p.source,
        targetLangs: p.targets,
      });
      if (!translations.length) {
        console.log(`   ⚠ ${p.c.name}: модель ничего не вернула`);
        continue;
      }
      // Свои переводы дополняем, а не затираем: --force пересобирает всё,
      // обычный прогон только доносит недостающие языки.
      const merged = new Map(
        (FORCE ? [] : p.c.translations ?? []).map((t) => [t.lang, t]),
      );
      for (const t of translations) merged.set(t.lang, t);

      p.c.lang = p.source;
      p.c.translations = [...merged.values()];
      await p.c.save();
      done += 1;
      console.log(
        `   ✅ ${p.c.name} → ` +
          translations.map((t) => `${t.lang}: ${t.name}`).join(" · "),
      );
    } catch (err) {
      console.log(`   ❌ ${p.c.name}: ${err?.message ?? err}`);
    }
  }

  console.log(`\nПереведено рубрик: ${done} из ${plan.length}`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("❌", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
