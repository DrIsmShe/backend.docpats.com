// scripts/translate-missing-keys.mjs
//
// Перевод ключей, у которых русский запасной текст утекал во все языки.
//
// Как возникла проблема. Многие вызовы написаны как
// t("ключ", { defaultValue: "Русский текст" }). Если ключа нет в локали,
// i18next подставляет defaultValue — то есть русский текст, и на
// азербайджанской странице появляются русские подписи. Ключа не было НИ В
// ОДНОЙ локали, включая русскую, поэтому сверка локалей между собой такие
// дыры не находила: они одинаково пусты везде.
//
// Скрипт берёт найденные пары «ключ → русский текст», переводит их пачками
// и раскладывает по локалям. Русская локаль тоже заполняется: значение
// должно жить в файле перевода, а не в коде.
//
// Запуск:  node scripts/translate-missing-keys.mjs <файл.json> <namespace>

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
// Ключ берём из .env рядом со скриптом: иначе он теряется при запуске
// через nohup, когда переменные окружения не наследуются.
import dotenv from "dotenv";

dotenv.config();

const INPUT = process.argv[2];
const NS = process.argv[3] || "clinic";
// Корень локалей отдельным параметром: SDK стоит в бэкенде, а файлы
// переводов лежат в клиенте — скрипт запускается из одного, пишет в другое.
const LOCALES_ROOT = process.argv[4] || path.join("public", "locales");
const LANGS = { en: "English", az: "Azerbaijani", tr: "Turkish", ar: "Arabic" };
const BATCH = 40;

const client = new Anthropic({ timeout: 600_000 });

const missing = JSON.parse(fs.readFileSync(INPUT, "utf8"));
const entries = Object.entries(missing);
console.log(`Ключей к переводу: ${entries.length}`);

function setDeep(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

async function translateBatch(pairs, langName) {
  const payload = Object.fromEntries(pairs);
  const prompt = `Translate the values of this JSON object from Russian to ${langName}.

This is interface text of a medical clinic management system: buttons, section titles, empty-state messages, form labels.

RULES:
- Keep the keys EXACTLY as they are.
- Translate only the values.
- Keep leading symbols like "+" and trailing punctuation as in the original.
- Medical terminology must be precise and natural for a clinician.
- Return ONLY valid JSON, no commentary, no markdown fences.

${JSON.stringify(payload, null, 1)}`;

  const msg = await client.messages
    .stream({
      model: "claude-sonnet-4-5",
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    })
    .finalMessage();

  if (msg.stop_reason === "max_tokens") throw new Error("ответ оборван");

  let text = msg.content[0].text.trim();
  // Модель иногда оборачивает JSON в ```json — снимаем.
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(text);
}

const result = { ru: Object.fromEntries(entries) };

for (const [code, name] of Object.entries(LANGS)) {
  result[code] = {};
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    process.stdout.write(`  ${code}: ${i + 1}-${i + chunk.length}… `);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        Object.assign(result[code], await translateBatch(chunk, name));
        ok = true;
        console.log("готово");
      } catch (err) {
        console.log(`сбой (${err.message}), повтор`);
      }
    }
    if (!ok) throw new Error(`не удалось перевести пачку ${i} на ${code}`);
  }
}

// Раскладываем по файлам локалей.
for (const code of ["ru", ...Object.keys(LANGS)]) {
  const p = path.join(LOCALES_ROOT, code, `${NS}.json`);
  const json = JSON.parse(fs.readFileSync(p, "utf8"));
  let n = 0;
  for (const [key, value] of Object.entries(result[code])) {
    if (typeof value !== "string") continue;
    setDeep(json, key, value);
    n += 1;
  }
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`${code}: записано ${n}`);
}
console.log("Готово.");
