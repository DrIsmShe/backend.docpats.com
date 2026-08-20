#!/usr/bin/env node
// server/scripts/try-surgical-plan.mjs

/* ============================================================
   ЖИВАЯ ПРОВЕРКА РАЗБОРА ПЛАНА
   ============================================================
   Тесты проверяют обвязку на моках. Качество самого разбора так
   не проверить — его видно только на живых формулировках, какими
   врачи говорят на самом деле. Этот скрипт для того и нужен.

   Ни Mongo, ни Express не поднимает: разбор от них не зависит.

   Запуск:
     node scripts/try-surgical-plan.mjs "убрать горбинку и приподнять кончик"

     node scripts/try-surgical-plan.mjs "кончик слишком торчит, убрать 3 мм" \
       --measurements '{"tip_projection":31,"nasal_length":50}' \
       --gender female

     node scripts/try-surgical-plan.mjs --demo     # набор типовых запросов

   Нужен ANTHROPIC_API_KEY в окружении или в .env.
   ============================================================ */

import "dotenv/config";

import { getCatalog } from "../modules/surgicalPlan/catalog/index.js";
import { parsePrompt } from "../modules/surgicalPlan/services/planParser.service.js";
import { validatePlan } from "../modules/surgicalPlan/services/planValidator.service.js";

const PROCEDURE = "rhinoplasty_lateral";

// Набор для --demo подобран по типам разбора, а не по красоте:
// точная величина, приблизительная, неоднозначная, вне каталога,
// конфликт и запрос на другом языке.
const DEMO = [
  {
    prompt: "приподнять кончик на 5 градусов и убрать горбинку 2 мм",
    measurements: { nasolabial_angle: 96, tip_projection: 29, nasal_length: 49 },
    gender: "female",
  },
  {
    prompt: "немного приподнять кончик, горбинку убрать",
    measurements: { nasolabial_angle: 96 },
    gender: "female",
  },
  { prompt: "сделать нос аккуратнее", measurements: null, gender: "unknown" },
  {
    prompt: "сузить крылья носа на 3 мм",
    measurements: null,
    gender: "female",
  },
  {
    prompt: "убрать горбинку 2 мм и одновременно поднять спинку на 2 мм",
    measurements: null,
    gender: "male",
  },
  {
    prompt: "rotate the tip up by 8 degrees, shorten the nose by 3 mm",
    measurements: { nasolabial_angle: 92, nasal_length: 52, tip_projection: 30 },
    gender: "male",
  },
];

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const SIGN = { increase: "↑", decrease: "↓", mixed: "↕" };

function printResult({ prompt, plan, validation, meta }) {
  console.log("\n" + "═".repeat(72));
  console.log("ЗАПРОС:", prompt);
  console.log("═".repeat(72));

  console.log("\nИТОГ:", plan.summary);

  if (plan.operations.length === 0) {
    console.log("\nОПЕРАЦИИ: —");
  } else {
    console.log("\nОПЕРАЦИИ:");
    for (const op of plan.operations) {
      const params = Object.entries(op.params)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      const mark = op.source === "explicit" ? "точно" : "выведено";
      console.log(
        `  • ${op.code}  ${params}   [${mark}, уверенность ${op.confidence}]`,
      );
      console.log(`    ${op.rationale}`);
    }
  }

  if (plan.clarifications.length) {
    console.log("\nНУЖНО УТОЧНИТЬ:");
    for (const c of plan.clarifications) {
      console.log(`  ${c.blocking ? "[блокирует]" : "[можно позже]"} ${c.question}`);
      console.log(`    ${c.why}`);
    }
  }

  if (plan.outOfScope.length) {
    console.log("\nВНЕ КАТАЛОГА:");
    for (const o of plan.outOfScope) {
      console.log(`  • ${o.request} — ${o.reason}`);
    }
  }

  if (validation.measurements.rows.length) {
    console.log("\nИЗМЕРЕНИЯ:");
    for (const r of validation.measurements.rows) {
      if (r.kind === "directional") {
        console.log(
          `  ${r.label.padEnd(28)} ${String(r.before ?? "—").padStart(7)}  ${SIGN[r.direction] || "?"} направление`,
        );
        continue;
      }
      const delta = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
      const status = r.statusAfter === "within_norm" ? "в норме" : r.statusAfter;
      console.log(
        `  ${r.label.padEnd(28)} ${String(r.before ?? "—").padStart(7)} → ` +
          `${String(r.after ?? "—").padStart(7)} ${(r.unit || "").padEnd(8)} ` +
          `${delta.padStart(7)}  ${r.after != null ? status : ""}`,
      );
    }
  }

  if (validation.findings.length) {
    console.log("\nЗАМЕЧАНИЯ:");
    for (const f of validation.findings) {
      const icon =
        f.severity === "error" ? "✗" : f.severity === "warning" ? "!" : "i";
      console.log(`  ${icon} [${f.code}] ${f.message}`);
    }
  }

  console.log(
    `\nВЕРДИКТ: ${validation.ok ? "план исполним" : "план исполнять нельзя"}` +
      `   (модель ${meta.model}, каталог ${meta.catalogVersion}, ` +
      `${meta.usage.inputTokens}→${meta.usage.outputTokens} токенов, ` +
      `кэш ${meta.usage.cacheReadTokens ? `+${meta.usage.cacheReadTokens} прочитано` : `${meta.usage.cacheCreationTokens || 0} записано`})`,
  );
}

async function runOne({ prompt, measurements, gender }) {
  const { catalog, preset } = getCatalog(PROCEDURE);

  const { plan, meta } = await parsePrompt({
    procedureCode: PROCEDURE,
    prompt,
    measurements,
    patientGender: gender,
  });

  const validation = validatePlan({
    plan,
    catalog,
    preset,
    measurements,
    patientGender: gender,
  });

  printResult({ prompt, plan, validation, meta });
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Нужен ANTHROPIC_API_KEY (в окружении или .env).");
    process.exit(1);
  }

  if (process.argv.includes("--demo")) {
    // Последовательно, а не параллельно: вывод должен читаться сверху вниз.
    for (const item of DEMO) {
      try {
        await runOne(item);
      } catch (err) {
        console.log(`\n✗ «${item.prompt}» — ${err.message}`);
      }
    }
    return;
  }

  const prompt = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!prompt) {
    console.error(
      'Использование: node scripts/try-surgical-plan.mjs "запрос врача" [--measurements JSON] [--gender male|female]',
    );
    process.exit(1);
  }

  const rawMeasurements = arg("measurements");
  await runOne({
    prompt,
    measurements: rawMeasurements ? JSON.parse(rawMeasurements) : null,
    gender: arg("gender", "unknown"),
  });
}

main().catch((err) => {
  console.error("Ошибка:", err.message);
  process.exit(1);
});
