#!/usr/bin/env node
/**
 * server/scripts/backfill-arena-translations.js
 *
 * Досоздаёт переводы опубликованных кейсов арены на все языки, кроме языка
 * оригинала. Нужен один раз — для кейсов, опубликованных до появления
 * автоперевода, и для тех, где модель тогда отказала.
 *
 * Новые кейсы бэкфилла не требуют: перевод запускается при публикации
 * (translation/onPublish.js), а пропущенное догоняется при первом открытии
 * кейса врачом (translation/translatedCase.js). Этот скрипт нужен, чтобы
 * первый врач не ждал перевод и чтобы каталог не оставался русским —
 * в списке кейсов перевод по требованию намеренно не запускается.
 *
 * Использование (из папки server/):
 *   node scripts/backfill-arena-translations.js                  # все станции, все языки
 *   node scripts/backfill-arena-translations.js --station=labs   # одна станция
 *   node scripts/backfill-arena-translations.js --langs=tr,az    # только эти языки
 *   node scripts/backfill-arena-translations.js --dry            # только показать план
 *   node scripts/backfill-arena-translations.js --limit=20       # первые N кейсов
 *
 * Идемпотентен: уже переведённое и не устаревшее пропускается, правленное
 * человеком не перезаписывается (решает translateCase.service.js).
 */

import "dotenv/config";
import mongoose from "mongoose";

import { ARENA_CASE_TYPES, ARENA_LANGUAGES } from "../modules/radiology/translation/arenaCaseTranslation.model.js";
import { translateCase } from "../modules/radiology/translation/translateCase.service.js";
import RadiologyCase from "../modules/radiology/radiology-cases/models/radiologyCase.model.js";
import LabCase from "../modules/radiology/labs-station/models/labCase.model.js";
import VpCase from "../modules/radiology/virtual-patient/models/vpCase.model.js";

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) throw new Error("MONGO_URL required");

const MODELS = { radiology: RadiologyCase, labs: LabCase, vp: VpCase };

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const DRY = process.argv.includes("--dry");
const LIMIT = Number(arg("limit", 0)) || 0;

const stations = (() => {
  const only = arg("station");
  if (!only) return ARENA_CASE_TYPES;
  if (!ARENA_CASE_TYPES.includes(only)) {
    throw new Error(`--station: ожидается один из ${ARENA_CASE_TYPES.join(", ")}`);
  }
  return [only];
})();

const langs = (() => {
  const only = arg("langs");
  if (!only) return null; // null = все, кроме языка оригинала
  const list = only.split(",").map((l) => l.trim()).filter(Boolean);
  const bad = list.filter((l) => !ARENA_LANGUAGES.includes(l));
  if (bad.length) throw new Error(`--langs: неизвестные языки: ${bad.join(", ")}`);
  return list;
})();

async function run() {
  await mongoose.connect(MONGO_URL);
  console.log(
    `Бэкфилл переводов: станции ${stations.join(", ")}; языки ${langs?.join(", ") ?? "все"}${DRY ? "; ПРОБНЫЙ ПРОГОН" : ""}`,
  );

  const totals = { cases: 0, created: 0, updated: 0, skipped: 0, failed: 0 };

  for (const caseType of stations) {
    const Model = MODELS[caseType];
    const query = { status: "published" };
    const cursor = Model.find(query).select("_id title").sort({ createdAt: 1 }).lean().cursor();

    let n = 0;
    for await (const doc of cursor) {
      if (LIMIT && n >= LIMIT) break;
      n += 1;
      totals.cases += 1;

      if (DRY) {
        console.log(`  [${caseType}] ${String(doc._id)} — ${doc.title ?? "(без названия)"}`);
        continue;
      }

      try {
        const report = await translateCase(caseType, doc._id, { langs });
        totals.created += report.created.length;
        totals.updated += report.updated.length;
        totals.skipped += report.skipped.length;
        totals.failed += report.failed.length;
        const parts = [
          report.created.length ? `+${report.created.map((r) => r.lang).join(",")}` : null,
          report.updated.length ? `~${report.updated.map((r) => r.lang).join(",")}` : null,
          report.failed.length ? `!${report.failed.map((r) => r.lang).join(",")}` : null,
        ].filter(Boolean);
        console.log(
          `  [${caseType}] ${String(doc._id)} ${parts.length ? parts.join(" ") : "без изменений"}`,
        );
      } catch (err) {
        // Один кейс не должен останавливать проход: остальные переведутся,
        // а этот виден в логе и берётся повторным запуском.
        totals.failed += 1;
        console.error(`  [${caseType}] ${String(doc._id)} ОШИБКА: ${err?.message ?? err}`);
      }
    }
  }

  console.log(
    `Готово. Кейсов: ${totals.cases}; создано: ${totals.created}; обновлено: ${totals.updated}; пропущено: ${totals.skipped}; с ошибкой: ${totals.failed}`,
  );
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
