#!/usr/bin/env node
/**
 * server/scripts/check-exam-program-langs.js
 *
 * Диагностика «тест азербайджанский, а вопросы приходят русские».
 *
 * Ничего не меняет — только читает и печатает. Нужен, чтобы отличить три
 * разные причины, которые снаружи выглядят одинаково:
 *
 *   1. Сервер работает на старом коде. До правки язык попытки брался как
 *      languages[0], а порядок в languages задаёт EXAM_LANGUAGES с "ru"
 *      первым: как только у теста появлялся русский перевод, ВСЕ врачи
 *      получали русские вопросы. Скрипт показывает, что подставил бы старый
 *      код и что подставит новый.
 *   2. Вопросов на нужном языке в банке нет вовсе (не опубликованы, лежат в
 *      in_review) — тогда и правильный код честно откатится на оригинал.
 *   3. Ярлык языка у вопросов проставлен неверно — это чинит
 *      scripts/fix-exam-item-langs.js.
 *
 * Использование (из папки server/):
 *   node scripts/check-exam-program-langs.js              # все опубликованные
 *   node scripts/check-exam-program-langs.js --all        # включая черновики
 *   node scripts/check-exam-program-langs.js --id=<id>    # один тест
 *   node scripts/check-exam-program-langs.js --lang=az    # что получит врач с этим языком
 */

import "dotenv/config";
import mongoose from "mongoose";

import ExamProgram from "../modules/education/education-catalog/models/examProgram.model.js";
import ExamItem from "../modules/education/education-items/models/examItem.model.js";
import { EXAM_LANGUAGES } from "../modules/education/constants.js";

const MONGO_URL =
  process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URL) throw new Error("MONGO_URL required");

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const ALL_STATUSES = has("all");
const ONLY_ID = arg("id");
const DOCTOR_LANG = arg("lang", "az");

const run = async () => {
  await mongoose.connect(MONGO_URL, {
    dbName: process.env.MONGODB_DB || "DOCPATS_NEW",
  });

  const query = ONLY_ID
    ? { _id: ONLY_ID }
    : ALL_STATUSES
      ? {}
      : { status: "published" };
  const programs = await ExamProgram.find(query).sort({ updatedAt: -1 }).lean();

  console.log(`Тестов найдено: ${programs.length}`);
  console.log(`Язык врача для проверки: ${DOCTOR_LANG}\n`);

  for (const p of programs) {
    // Языки считаем ровно так же, как recountPublishedItems: по вопросам во
    // всех рабочих статусах, кроме archived и rejected.
    const rows = await ExamItem.aggregate([
      {
        $match: {
          programId: p._id,
          status: { $nin: ["archived", "rejected"] },
        },
      },
      { $group: { _id: { lang: "$lang", status: "$status" }, n: { $sum: 1 } } },
    ]);

    const byLang = new Map();
    for (const r of rows) {
      const lang = r._id.lang ?? "—";
      const cur = byLang.get(lang) ?? { total: 0, published: 0 };
      cur.total += r.n;
      if (r._id.status === "published") cur.published += r.n;
      byLang.set(lang, cur);
    }

    const stored = p.languages ?? [];
    const oldPick = stored[0] ?? "ru";
    const newPick = stored.includes(DOCTOR_LANG) ? DOCTOR_LANG : oldPick;
    const hasPublished = (byLang.get(DOCTOR_LANG)?.published ?? 0) > 0;

    console.log(`── ${p.title}`);
    console.log(`   id ${p._id} · статус ${p.status}`);
    console.log(
      `   languages: [${stored.join(", ")}] · primaryLang: ${p.primaryLang ?? "не задан"}`,
    );
    console.log(
      `   переводы названия: ${
        (p.translations ?? []).length
          ? (p.translations ?? []).map((t) => t.lang).join(", ")
          : "нет"
      }`,
    );

    const breakdown = EXAM_LANGUAGES.filter((l) => byLang.has(l))
      .map((l) => {
        const v = byLang.get(l);
        return `${l}: ${v.published} опубл. из ${v.total}`;
      })
      .join(" · ");
    console.log(`   вопросы — ${breakdown || "нет ни одного"}`);

    const verdict =
      newPick === DOCTOR_LANG && hasPublished
        ? "✅ врач получит вопросы на своём языке"
        : !hasPublished
          ? `⚠ опубликованных вопросов на «${DOCTOR_LANG}» нет — откат на «${newPick}» правилен`
          : `⚠ «${DOCTOR_LANG}» отсутствует в languages — нужен recount`;

    console.log(
      `   язык попытки: старый код → ${oldPick} · новый код → ${newPick}`,
    );
    if (oldPick !== newPick) {
      console.log(
        `   ⚠ РАСХОЖДЕНИЕ: если врач видит «${oldPick}», сервер работает на старом коде`,
      );
    }
    console.log(`   ${verdict}\n`);
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("❌", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
