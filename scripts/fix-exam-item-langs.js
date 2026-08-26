#!/usr/bin/env node
/**
 * server/scripts/fix-exam-item-langs.js
 *
 * Чинит язык уже созданных вопросов банка и пересобирает languages тестов.
 *
 * ЗАЧЕМ. Ярлык языка у вопроса (ExamItem.lang) ставился из формы импорта, а
 * не по тексту. В форме генерации до недавнего стоял жёсткий "ru", и
 * азербайджанский тест заказывали русским, не заметив селектора; модель,
 * которую тянет за темой, тоже могла написать не на том языке, что заказан.
 * Языки теста (ExamProgram.languages) — производная от этих ярлыков
 * (education-catalog/services/program.service.js → recountPublishedItems),
 * поэтому тест попадал в каталог не под тем языком, и фильтр по языку его не
 * находил.
 *
 * Дальше это уже не повторится: генерация берёт язык из ответа модели
 * (ingest.service → applyFirstBatchStructure), импорт из файла — из текста,
 * а форма подставляет рабочий язык оператора. Скрипт нужен ровно один раз —
 * для того, что уже лежит в базе.
 *
 * КАК ОПРЕДЕЛЯЕМ ЯЗЫК. По ПРЕОБЛАДАЮЩЕЙ письменности, а не по её наличию.
 * Разница не теоретическая: первая версия этого скрипта спрашивала «есть ли
 * в тексте кириллица» и на сухом прогоне предложила семь правок, все до
 * одной вредные. Среди них — вопрос «In the series of letters А, В, Д, Ж...
 * (Russian alphabet without Ё)»: английский вопрос ПРО русский алфавит, где
 * кириллица — предмет разговора, а не язык текста. Тот же вопрос нашёлся на
 * турецком и на арабском, и азербайджанские вопросы про Юнга — тоже.
 *
 *   кириллицы больше всех  → ru
 *   арабицы больше всех    → ar
 *   латиницы больше всех и есть «ə» → az   (буквы нет ни в турецком, ни в
 *                                           английском)
 *
 * Преобладание требуем уверенное (DOMINANCE), и текст должен быть достаточно
 * длинным (MIN_LETTERS) — на пяти буквах любая доля случайна.
 *
 * Латиницу без «ə» не трогаем совсем: турецкий и английский так не
 * различить. Ошибиться здесь хуже, чем оставить как есть — неверная правка
 * тихо уводит вопрос из выдачи на его языке. Молчание скрипта означает «не
 * уверен», а не «всё хорошо».
 *
 * Смотрим на stem + тексты вариантов: заголовок вопроса бывает коротким и
 * без характерных букв, а вместе с вариантами материала достаточно.
 *
 * ЧТО СЧИТАЕТСЯ СОВПАДЕНИЕМ. Правим только когда определённый язык
 * отличается от записанного. Вопросы-переводы (translationOf) трогаем на
 * общих основаниях: у них тоже бывает неверный ярлык, а сборка сессии
 * фильтрует по lang.
 *
 * Использование (из папки server/):
 *   node scripts/fix-exam-item-langs.js               # сухой прогон: только отчёт
 *   node scripts/fix-exam-item-langs.js --apply       # записать изменения
 *   node scripts/fix-exam-item-langs.js --program=<id> # только один тест
 *   node scripts/fix-exam-item-langs.js --limit=50    # первые N вопросов
 *
 * Идемпотентен: повторный прогон на выправленной базе не находит работы.
 */

import "dotenv/config";
import mongoose from "mongoose";

import ExamItem from "../modules/education/education-items/models/examItem.model.js";
import ExamProgram from "../modules/education/education-catalog/models/examProgram.model.js";
import { recountPublishedItems } from "../modules/education/education-catalog/services/program.service.js";

const MONGO_URL =
  process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URL) throw new Error("MONGO_URL required");

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const APPLY = has("apply");
const PROGRAM = arg("program");
const LIMIT = Number(arg("limit", 0)) || 0;

// Какую долю букв должна занимать письменность, чтобы считаться языком
// текста. 0.7 отсекает вкрапления-предмет («…буквы А, В, Д, Ж…» внутри
// английского вопроса) и при этом не мешает обычному тексту с латинскими
// терминами внутри русского.
const DOMINANCE = 0.7;
// Ниже этого числа букв доля ничего не значит.
const MIN_LETTERS = 12;

/**
 * Язык текста по преобладающей письменности — или null, если уверенности нет.
 */
function detectLang(text) {
  const t = String(text ?? "");
  const cyr = (t.match(/[Ѐ-ӿ]/g) ?? []).length;
  const arab = (t.match(/[؀-ۿݐ-ݿ]/g) ?? []).length;
  const lat = (t.match(/[A-Za-zÀ-ɏəƏ]/g) ?? []).length;

  const total = cyr + arab + lat;
  if (total < MIN_LETTERS) return null;

  if (cyr / total >= DOMINANCE) return "ru";
  if (arab / total >= DOMINANCE) return "ar";
  if (lat / total >= DOMINANCE) {
    // «ə» — единственная буква, надёжно отделяющая азербайджанский от
    // турецкого и английского. Нет её — молчим: tr и en так не различить.
    return /[əƏ]/.test(t) ? "az" : null;
  }
  return null;
}

/** Весь текст вопроса: сам вопрос плюс варианты. */
function itemText(item) {
  const parts = [item.stem ?? ""];
  for (const o of item.options ?? []) parts.push(o?.text ?? "");
  return parts.join(" ");
}

const run = async () => {
  await mongoose.connect(MONGO_URL, {
    dbName: process.env.MONGODB_DB || "DOCPATS_NEW",
  });
  console.log("✅ MongoDB подключена");

  const query = {};
  if (PROGRAM) query.programId = new mongoose.Types.ObjectId(PROGRAM);

  let cursor = ExamItem.find(query)
    .select("_id programId lang stem options")
    .lean();
  if (LIMIT) cursor = cursor.limit(LIMIT);
  const items = await cursor;

  console.log(`Вопросов к проверке: ${items.length}`);

  const changes = [];
  let undetected = 0;
  for (const item of items) {
    const detected = detectLang(itemText(item));
    if (!detected) {
      undetected += 1;
      continue;
    }
    if (detected === item.lang) continue;
    changes.push({ item, from: item.lang, to: detected });
  }

  // Сводка по направлениям правки: она отвечает на главный вопрос перед
  // применением — «что и куда поедет», а не «сколько строк тронется».
  const byPair = new Map();
  for (const c of changes) {
    const key = `${c.from} → ${c.to}`;
    byPair.set(key, (byPair.get(key) ?? 0) + 1);
  }

  console.log(`\nПисьменность ничего не сказала (не трогаем): ${undetected}`);
  console.log(`К исправлению: ${changes.length}`);
  for (const [pair, n] of [...byPair.entries()].sort()) {
    console.log(`   ${pair}: ${n}`);
  }

  // Примеры — чтобы решение принималось по тексту, а не по цифре.
  console.log("\nПримеры (до 10):");
  for (const c of changes.slice(0, 10)) {
    const stem = String(c.item.stem ?? "").replace(/\s+/g, " ").slice(0, 90);
    console.log(`   [${c.from} → ${c.to}] ${stem}`);
  }

  const programIds = [...new Set(changes.map((c) => String(c.item.programId)))];
  console.log(`\nЗатронутых тестов: ${programIds.length}`);

  if (!APPLY) {
    console.log("\n— сухой прогон, ничего не записано. Повторите с --apply.");
    await mongoose.disconnect();
    return;
  }

  // Пишем по языкам одним bulk-запросом на направление: правок могут быть
  // тысячи, и по одному обновлению на документ здесь ни к чему.
  const ops = changes.map((c) => ({
    updateOne: { filter: { _id: c.item._id }, update: { $set: { lang: c.to } } },
  }));
  if (ops.length) {
    const res = await ExamItem.bulkWrite(ops, { ordered: false });
    console.log(`\n✅ Обновлено вопросов: ${res.modifiedCount ?? ops.length}`);
  }

  // Пересобираем languages у затронутых тестов: ради этого всё и затевалось —
  // именно languages читает фильтр каталога.
  for (const id of programIds) {
    await recountPublishedItems(id);
  }
  console.log(`✅ Пересобраны языки тестов: ${programIds.length}`);

  const affected = await ExamProgram.find({ _id: { $in: programIds } })
    .select("title languages")
    .lean();
  console.log("\nСтало:");
  for (const p of affected) {
    console.log(`   ${(p.languages ?? []).join(", ") || "—"}  ${p.title}`);
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("❌", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
